import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { BasicDeployApi, Container } from "./api";

// The bastion (sshpiperd) reaches every container. The username is the
// container's subdomain, the private key is issued per container by the
// platform, and the bastion listens on 2222 at the DNS-only host (the app's
// HTTPS apex is Cloudflare-proxied and blackholes SSH).
const SSH_HOST = "ssh.basicdeploy.com";
const SSH_PORT = 2222;
const REMOTE_SSH_EXT = "ms-vscode-remote.remote-ssh";
const REMOTE_WORKDIR = "/workspace";

// We do not edit the user's main ~/.ssh/config in place. Instead we own a
// single managed file and add one Include line at the top of the main config.
// Every BasicDeploy host lives in the managed file, so uninstalling is a clean
// one-line removal and we never clobber the user's own entries.
function sshDir(): string {
  return path.join(os.homedir(), ".ssh");
}
function managedConfigPath(): string {
  return path.join(sshDir(), "basicdeploy_config");
}
function mainConfigPath(): string {
  return path.join(sshDir(), "config");
}
function hostAlias(subdomain: string): string {
  return `bd-${subdomain}`;
}

async function chmod600(p: string): Promise<void> {
  try {
    await fs.chmod(p, 0o600);
  } catch {
    // Windows and some filesystems lack POSIX perms; ssh tolerates it there.
  }
}

// Persist the container's private key to a stable per-container file so the
// SSH client and Remote-SSH can find it. Overwrites on every open so a rotated
// key is picked up.
async function writeKey(
  context: vscode.ExtensionContext,
  subdomain: string,
  privateKeyPem: string,
): Promise<string> {
  const dir = path.join(context.globalStorageUri.fsPath, "ssh-keys");
  await fs.mkdir(dir, { recursive: true });
  const keyPath = path.join(dir, `${subdomain}.key`);
  const body = privateKeyPem.endsWith("\n") ? privateKeyPem : privateKeyPem + "\n";
  await fs.writeFile(keyPath, body, { mode: 0o600 });
  await chmod600(keyPath);
  return keyPath;
}

// Expand a leading ~ to the home dir (ssh config paths from settings use it).
function untildify(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// The config file Remote-SSH actually reads. If the user set
// `remote.SSH.configFile`, Remote-SSH reads THAT, not ~/.ssh/config — so an
// Include we only put in ~/.ssh/config is never seen and the alias resolves to a
// literal hostname ("Could not resolve hostname bd-..."). Return it when set.
function remoteSshConfigFile(): string | undefined {
  const v = vscode.workspace.getConfiguration("remote.SSH").get<string>("configFile");
  return v && v.trim() ? untildify(v.trim()) : undefined;
}

// --- managed region inside the ssh config file(s) Remote-SSH actually reads ---
// Remote-SSH does NOT reliably follow `Include`, so an aliased Host in a separate
// included file often fails to resolve ("Could not resolve hostname bd-..."). We
// write our Host blocks DIRECTLY into ~/.ssh/config (and the custom
// remote.SSH.configFile when set) inside a delimited region, which both Remote-SSH
// and the ssh CLI always read. Uninstall is a clean removal of the region.
const REGION_BEGIN = "# BEGIN BASICDEPLOY (managed - do not edit)";
const REGION_END = "# END BASICDEPLOY";

// The config file(s) to keep in sync: ~/.ssh/config (CLI + Remote-SSH default) plus
// the user's custom remote.SSH.configFile when they set a different one.
function targetConfigFiles(): string[] {
  const files = [mainConfigPath()];
  const custom = remoteSshConfigFile();
  if (custom && path.resolve(custom) !== path.resolve(mainConfigPath())) {
    files.push(custom);
  }
  return files;
}

// The body (our Host blocks) currently inside the managed region of a config string.
function extractRegion(config: string): string {
  const b = config.indexOf(REGION_BEGIN);
  const e = config.indexOf(REGION_END);
  if (b === -1 || e === -1 || e < b) {
    return "";
  }
  const afterBegin = config.indexOf("\n", b);
  return afterBegin === -1 ? "" : config.slice(afterBegin + 1, e).trim();
}

// Replace the managed region with `body`, or append a fresh region at the end.
function setRegion(config: string, body: string): string {
  const region = `${REGION_BEGIN}\n${body.trim()}\n${REGION_END}\n`;
  const b = config.indexOf(REGION_BEGIN);
  const e = config.indexOf(REGION_END);
  if (b !== -1 && e !== -1 && e >= b) {
    const endLineEnd = config.indexOf("\n", e);
    const tail = endLineEnd === -1 ? "" : config.slice(endLineEnd + 1);
    return (config.slice(0, b) + region + tail).replace(/\n{3,}/g, "\n\n");
  }
  const base = config.trimEnd();
  return (base ? base + "\n\n" : "") + region;
}

// Write the managed region `body` into every target config file (idempotent).
async function writeRegionToTargets(body: string): Promise<void> {
  for (const f of targetConfigFiles()) {
    await fs.mkdir(path.dirname(f), { recursive: true });
    let cfg = "";
    try {
      cfg = await fs.readFile(f, "utf8");
    } catch {
      // file does not exist yet
    }
    await fs.writeFile(f, setRegion(cfg, body), { mode: 0o600 });
    await chmod600(f);
  }
}

// One-time migration off the old Include-based layout (v<=0.7.1): drop our Include
// line from the config(s) and delete the separate managed file, so stale aliases in
// it can't shadow the in-config region. Idempotent, best-effort.
async function removeLegacyInclude(): Promise<void> {
  const includeLine = `Include ${managedConfigPath()}`;
  for (const f of targetConfigFiles()) {
    let cfg = "";
    try {
      cfg = await fs.readFile(f, "utf8");
    } catch {
      continue;
    }
    if (!cfg.includes(includeLine)) {
      continue;
    }
    const cleaned = cfg
      .split("\n")
      .filter((l) => l.trim() !== includeLine)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    await fs.writeFile(f, cleaned, { mode: 0o600 });
  }
  try {
    await fs.rm(managedConfigPath(), { force: true });
  } catch {
    // nothing to remove
  }
}

// Upsert the Host block for one container into the managed region of the ssh
// config file(s) Remote-SSH reads directly. Returns the host alias.
async function upsertHost(subdomain: string, keyPath: string): Promise<string> {
  await removeLegacyInclude();
  const alias = hostAlias(subdomain);
  const block = [
    `Host ${alias}`,
    `    HostName ${SSH_HOST}`,
    `    Port ${SSH_PORT}`,
    `    User ${subdomain}`,
    // Quote the path: on macOS the key lives under ".../Application Support/..."
    // and an unquoted space makes ssh reject the whole config ("identityfile extra
    // arguments at end of line" -> terminating, 1 bad configuration options).
    `    IdentityFile "${keyPath}"`,
    `    IdentitiesOnly yes`,
    `    StrictHostKeyChecking accept-new`,
  ].join("\n");

  // Canonical current blocks come from ~/.ssh/config's region; replace this alias.
  let mainCfg = "";
  try {
    mainCfg = await fs.readFile(mainConfigPath(), "utf8");
  } catch {
    // no config yet
  }
  const existing = stripHostBlock(extractRegion(mainCfg), alias).trim();
  const body = existing ? `${existing}\n\n${block}` : block;
  await writeRegionToTargets(body);
  return alias;
}

// Remove a `Host <alias>` block and its indented body from a config string.
function stripHostBlock(config: string, alias: string): string {
  const lines = config.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const isHostLine = /^Host\s+/.test(line);
    if (isHostLine) {
      skipping = line.trim() === `Host ${alias}`;
      if (skipping) {
        continue;
      }
    }
    if (skipping) {
      // Indented continuation lines and blanks belong to the skipped block.
      if (/^\s/.test(line) || line.trim() === "") {
        continue;
      }
      skipping = false;
    }
    out.push(line);
  }
  return out.join("\n");
}

async function ensureRemoteSshInstalled(): Promise<boolean> {
  if (vscode.extensions.getExtension(REMOTE_SSH_EXT)) {
    return true;
  }
  const install = "Install Remote-SSH";
  const choice = await vscode.window.showInformationMessage(
    "Remote development needs the Remote-SSH extension. Install it now?",
    install,
    "Cancel",
  );
  if (choice !== install) {
    return false;
  }
  await vscode.commands.executeCommand("workbench.extensions.installExtension", REMOTE_SSH_EXT);
  return !!vscode.extensions.getExtension(REMOTE_SSH_EXT);
}

// Full flow: fetch the container's key, write the SSH config, then hand off to
// Remote-SSH to open a window connected to the container.
export async function connectSsh(
  context: vscode.ExtensionContext,
  api: BasicDeployApi,
  container: Container,
): Promise<void> {
  const full = await api.getContainer(container.id);
  const key = full.sshKey || full.guestSshKey;
  if (!key) {
    vscode.window.showErrorMessage(
      "No SSH key available for this container. Only the owner (or a shared guest) can connect.",
    );
    return;
  }
  if (!(await ensureRemoteSshInstalled())) {
    return;
  }

  const keyPath = await writeKey(context, full.subdomain, key);
  const alias = await upsertHost(full.subdomain, keyPath);

  const openFolder = "Open /workspace";
  const newWindow = "New window";
  const choice = await vscode.window.showQuickPick([openFolder, newWindow], {
    placeHolder: `Connect to ${full.subdomain} over SSH`,
  });
  if (!choice) {
    return;
  }

  if (choice === openFolder) {
    const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${alias}${REMOTE_WORKDIR}`);
    await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
  } else {
    // Open an empty window attached to the host; the Remote-SSH command reads
    // our managed config to resolve the alias.
    await vscode.commands.executeCommand("opensshremotes.openEmptyWindow", { host: alias });
  }
}

// Clean up a container's managed host block and key (on delete).
export async function forgetSshHost(
  context: vscode.ExtensionContext,
  subdomain: string,
): Promise<void> {
  try {
    let mainCfg = "";
    try {
      mainCfg = await fs.readFile(mainConfigPath(), "utf8");
    } catch {
      // no config
    }
    const body = stripHostBlock(extractRegion(mainCfg), hostAlias(subdomain)).trim();
    await writeRegionToTargets(body);
  } catch {
    // no managed region, nothing to forget
  }
  try {
    const keyPath = path.join(context.globalStorageUri.fsPath, "ssh-keys", `${subdomain}.key`);
    await fs.rm(keyPath, { force: true });
  } catch {
    // best effort
  }
}
