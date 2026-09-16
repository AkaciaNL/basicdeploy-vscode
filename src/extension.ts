import * as vscode from "vscode";
import { BasicDeployApi } from "./api";
import { AUTH_PROVIDER_ID, BasicDeployAuthProvider, getSession } from "./auth";
import { ContainerItem, ContainersProvider } from "./containersView";
import { DatabaseProvider } from "./databaseView";
import { StorageProvider, openObject } from "./storageView";
import { KafkaProvider, TopicNode } from "./kafkaView";
import { DomainNode, DomainsProvider } from "./domainsView";
import { SupportProvider, TicketNode } from "./supportView";
import { RowsDocProvider, TicketDocProvider, ROWS_SCHEME, TICKET_SCHEME } from "./docs";
import { LogStreamer } from "./logStream";
import type { UploadImage } from "./api";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { connectSsh, forgetSshHost } from "./ssh";
import { deployWorkspace, pickWorkspaceFolder } from "./deploy";
import { registerTools } from "./tools";
import { registerChatParticipant } from "./chat";

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("BasicDeploy");
  context.subscriptions.push(output);

  // One auth provider, one API client. The client reads the key straight from
  // the provider's SecretStorage so there is a single source of truth.
  const auth = new BasicDeployAuthProvider(context, new BasicDeployApi(async () => undefined));
  const api = new BasicDeployApi(() => auth.currentKey());
  // Rewire the provider's own validation client onto the real api instance is
  // not needed: the provider only uses whoami with a raw key, and the shared
  // client below reads the stored key for every other call.

  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(AUTH_PROVIDER_ID, "BasicDeploy", auth, {
      supportsMultipleAccounts: false,
    }),
  );

  const containers = new ContainersProvider(api);
  const database = new DatabaseProvider(api);
  const storage = new StorageProvider(api);
  const kafka = new KafkaProvider(api);
  const domains = new DomainsProvider(api);
  const support = new SupportProvider(api);
  const rowsDoc = new RowsDocProvider(api);
  const ticketDoc = new TicketDocProvider(api);
  const logs = new LogStreamer(api);
  context.subscriptions.push(logs);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(ROWS_SCHEME, rowsDoc),
    vscode.workspace.registerTextDocumentContentProvider(TICKET_SCHEME, ticketDoc),
  );

  const refreshAll = () => {
    containers.refresh();
    database.refresh();
    storage.refresh();
    kafka.refresh();
    domains.refresh();
    support.refresh();
  };

  context.subscriptions.push(
    vscode.window.createTreeView("basicdeploy.containers", { treeDataProvider: containers }),
    vscode.window.createTreeView("basicdeploy.database", { treeDataProvider: database }),
    vscode.window.createTreeView("basicdeploy.storage", { treeDataProvider: storage }),
    vscode.window.createTreeView("basicdeploy.kafka", { treeDataProvider: kafka }),
    vscode.window.createTreeView("basicdeploy.domains", { treeDataProvider: domains }),
    vscode.window.createTreeView("basicdeploy.support", { treeDataProvider: support }),
  );

  // Refresh every view whenever the account changes.
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === AUTH_PROVIDER_ID) {
        refreshAll();
      }
    }),
  );

  registerTools(context, api);
  registerChatParticipant(context, api);
  registerCommands(context, api, {
    containers,
    database,
    storage,
    kafka,
    domains,
    support,
    rowsDoc,
    ticketDoc,
    logs,
    refreshAll,
  });

  // Prime the views if already signed in.
  refreshAll();
}

interface Providers {
  containers: ContainersProvider;
  database: DatabaseProvider;
  storage: StorageProvider;
  kafka: KafkaProvider;
  domains: DomainsProvider;
  support: SupportProvider;
  rowsDoc: RowsDocProvider;
  ticketDoc: TicketDocProvider;
  logs: LogStreamer;
  refreshAll: () => void;
}

function registerCommands(
  context: vscode.ExtensionContext,
  api: BasicDeployApi,
  p: Providers,
): void {
  const { containers, database, storage, kafka, domains, support, rowsDoc, ticketDoc, logs, refreshAll } = p;
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("basicdeploy.signIn", async () => {
    await getSession(true);
    refreshAll();
  });

  reg("basicdeploy.signOut", async () => {
    // Remove via the accounts menu is the native path; this command clears our
    // stored key directly for convenience.
    const sessions = await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
      createIfNone: false,
    });
    if (sessions) {
      await vscode.commands.executeCommand("workbench.action.closeAccountsMenu");
    }
    vscode.window.showInformationMessage(
      "Use the Accounts menu (bottom left) to sign out of BasicDeploy.",
    );
  });

  reg("basicdeploy.refresh", () => containers.refresh());
  reg("basicdeploy.refreshDatabase", () => database.refresh());
  reg("basicdeploy.refreshStorage", () => storage.refresh());
  reg("basicdeploy.refreshKafka", () => kafka.refresh());
  reg("basicdeploy.refreshDomains", () => domains.refresh());
  reg("basicdeploy.refreshSupport", () => support.refresh());

  reg("basicdeploy.openTicket", (number?: number) => {
    if (typeof number === "number") {
      void ticketDoc.open(number);
    }
  });

  reg("basicdeploy.newTicket", async () => {
    const session = await getSession(true);
    if (!session) {
      return;
    }
    const subject = await vscode.window.showInputBox({
      title: "New support ticket",
      prompt: "Subject",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "A subject is required."),
    });
    if (!subject) {
      return;
    }
    const body = await vscode.window.showInputBox({
      title: "New support ticket",
      prompt: "Describe the issue (optional)",
      ignoreFocusOut: true,
    });
    if (body === undefined) {
      return;
    }
    const images = await pickImages("Attach images to the ticket (optional)");
    await withProgress("Creating support ticket...", async () => {
      const ticket = await api.createTicket(subject.trim(), body.trim(), images);
      support.refresh();
      vscode.window.showInformationMessage(`Created ticket #${ticket.number}.`);
      await ticketDoc.open(ticket.number);
    });
  });

  // Resolve the target ticket from a tree node, an explicit number, or the
  // active ticket document.
  const resolveTicket = (arg?: TicketNode | number): number | undefined => {
    if (typeof arg === "number") {
      return arg;
    }
    if (arg?.ticket) {
      return arg.ticket.number;
    }
    return ticketDoc.activeNumber();
  };

  reg("basicdeploy.replyTicket", async (arg?: TicketNode | number) => {
    const number = resolveTicket(arg);
    if (number === undefined) {
      return;
    }
    const body = await vscode.window.showInputBox({
      title: `Reply to ticket #${number}`,
      prompt: "Your reply",
      ignoreFocusOut: true,
    });
    if (body === undefined) {
      return;
    }
    const images = await pickImages("Attach images to the reply (optional)");
    if (!body.trim() && images.length === 0) {
      return;
    }
    await withProgress(`Replying to #${number}...`, async () => {
      await api.replyTicket(number, body.trim(), images);
      ticketDoc.refresh(number);
      support.refresh();
    });
  });

  reg("basicdeploy.closeTicket", async (arg?: TicketNode | number) => {
    const number = resolveTicket(arg);
    if (number === undefined) {
      return;
    }
    await withProgress(`Closing ticket #${number}...`, async () => {
      await api.setTicketStatus(number, true);
      ticketDoc.refresh(number);
      support.refresh();
    });
  });

  reg("basicdeploy.reopenTicket", async (arg?: TicketNode | number) => {
    const number = resolveTicket(arg);
    if (number === undefined) {
      return;
    }
    await withProgress(`Reopening ticket #${number}...`, async () => {
      await api.setTicketStatus(number, false);
      ticketDoc.refresh(number);
      support.refresh();
    });
  });

  reg("basicdeploy.openAttachment", async () => {
    const number = ticketDoc.activeNumber();
    if (number === undefined) {
      vscode.window.showInformationMessage("Open a support ticket first.");
      return;
    }
    const detail = ticketDoc.cached(number) ?? (await api.getTicket(number));
    const items = detail.messages
      .flatMap((m) => m.attachments ?? [])
      .map((a) => ({ label: a.filename, description: a.contentType, id: a.id }));
    if (items.length === 0) {
      vscode.window.showInformationMessage("This ticket has no attachments.");
      return;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Open attachment" });
    if (!pick) {
      return;
    }
    await withProgress(`Opening ${pick.label}...`, async () => {
      const { bytes } = await api.getAttachment(pick.id);
      const dir = path.join(context.globalStorageUri.fsPath, "attachments");
      await fs.mkdir(dir, { recursive: true });
      const safe = pick.label.replace(/[^A-Za-z0-9._-]/g, "_") || "attachment";
      const file = path.join(dir, safe);
      await fs.writeFile(file, bytes);
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
    });
  });

  reg("basicdeploy.loadMoreTables", () => database.loadMore());
  reg("basicdeploy.loadMoreObjects", () => storage.loadMore());

  reg("basicdeploy.openTable", (table?: string) => {
    if (table) {
      void rowsDoc.open(table);
    }
  });
  reg("basicdeploy.tableNextPage", () => rowsDoc.page(1));
  reg("basicdeploy.tablePrevPage", () => rowsDoc.page(-1));

  reg("basicdeploy.openObject", async (key?: string) => {
    if (!key) {
      return;
    }
    try {
      await openObject(context, api, key);
    } catch (err) {
      vscode.window.showErrorMessage(`Could not open object: ${errorMessage(err)}`);
    }
  });

  reg("basicdeploy.copyConnectionInfo", async () => {
    await withProgress("Fetching connection info...", async () => {
      const info = await api.connectInfo();
      const text = info.copyForLlm ? String(info.copyForLlm) : JSON.stringify(info, null, 2);
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("Connection info copied to clipboard.");
    });
  });

  reg("basicdeploy.createTopic", async () => {
    const label = await vscode.window.showInputBox({
      title: "New Kafka topic",
      prompt: "Optional label (a topic name is generated with your prefix)",
      ignoreFocusOut: true,
    });
    if (label === undefined) {
      return;
    }
    await withProgress("Creating topic...", async () => {
      const name = await api.createTopic(label.trim() || undefined);
      kafka.refresh();
      vscode.window.showInformationMessage(`Created topic ${name}`);
    });
  });

  reg("basicdeploy.purgeTopic", async (node?: TopicNode) => {
    if (!node?.topic) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Purge (empty) topic ${node.topic.name}?`,
      { modal: true },
      "Purge",
    );
    if (confirm !== "Purge") {
      return;
    }
    await withProgress(`Purging ${node.topic.name}...`, async () => {
      await api.purgeTopic(node.topic!.name);
      kafka.refresh();
    });
  });

  reg("basicdeploy.deleteTopic", async (node?: TopicNode) => {
    if (!node?.topic) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete topic ${node.topic.name}? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }
    await withProgress(`Deleting ${node.topic.name}...`, async () => {
      await api.deleteTopic(node.topic!.name);
      kafka.refresh();
    });
  });

  reg("basicdeploy.createContainer", async () => {
    await withProgress("Creating container...", async () => {
      const c = await api.createContainer();
      vscode.window.showInformationMessage(
        `Created ${c.subdomain} at https://${c.subdomain}.basicdeploy.com`,
      );
      refreshAll();
    });
  });

  reg("basicdeploy.deployWorkspace", () => runDeploy(api, containers, undefined));

  reg("basicdeploy.deployToContainer", (item?: ContainerItem) =>
    runDeploy(api, containers, item?.container.id),
  );

  reg("basicdeploy.wake", async (item?: ContainerItem) => {
    if (!item) {
      return;
    }
    await withProgress(`Waking ${item.container.subdomain}...`, async () => {
      await api.wake(item.container.id);
      containers.refresh();
    });
  });

  reg("basicdeploy.sleep", async (item?: ContainerItem) => {
    if (!item) {
      return;
    }
    await withProgress(`Sleeping ${item.container.subdomain}...`, async () => {
      await api.sleep(item.container.id);
      containers.refresh();
    });
  });

  reg("basicdeploy.delete", async (item?: ContainerItem) => {
    if (!item) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete container ${item.container.subdomain}? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }
    await withProgress(`Deleting ${item.container.subdomain}...`, async () => {
      await api.deleteContainer(item.container.id);
      logs.stop(item.container.id);
      await forgetSshHost(context, item.container.subdomain);
      refreshAll();
    });
  });

  reg("basicdeploy.openUrl", async (item?: ContainerItem) => {
    if (!item) {
      return;
    }
    await vscode.env.openExternal(
      vscode.Uri.parse(`https://${item.container.subdomain}.basicdeploy.com`),
    );
  });

  reg("basicdeploy.viewLogs", async (item?: ContainerItem) => {
    if (!item) {
      return;
    }
    await withProgress(`Fetching logs for ${item.container.subdomain}...`, async () => {
      const text = await api.logs(item.container.id, 500);
      output.clear();
      output.appendLine(`# logs: ${item.container.subdomain}`);
      output.appendLine(text || "(no logs)");
      output.show(true);
    });
  });

  reg("basicdeploy.streamLogs", (item?: ContainerItem) => {
    if (!item) {
      return;
    }
    logs.toggle(item.container);
  });

  reg("basicdeploy.openSsh", async (item?: ContainerItem) => {
    if (!item) {
      return;
    }
    const session = await getSession(true);
    if (!session) {
      return;
    }
    try {
      await connectSsh(context, api, item.container);
    } catch (err) {
      vscode.window.showErrorMessage(`SSH failed: ${errorMessage(err)}`);
    }
  });

  reg("basicdeploy.addDomain", async (node?: DomainNode) => {
    const container = node?.container;
    if (!container) {
      return;
    }
    const domain = await vscode.window.showInputBox({
      title: `Add custom domain to ${container.subdomain}`,
      prompt: "Domain name (for example app.example.com)",
      ignoreFocusOut: true,
      validateInput: (v) =>
        /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim()) ? undefined : "Enter a valid domain.",
    });
    if (!domain) {
      return;
    }
    await withProgress(`Adding ${domain}...`, async () => {
      await api.addDomain(container.id, domain.trim());
      domains.refresh();
    });
  });

  reg("basicdeploy.removeDomain", async (node?: DomainNode) => {
    if (!node?.container || !node.domain) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Remove domain ${node.domain.domain}?`,
      { modal: true },
      "Remove",
    );
    if (confirm !== "Remove") {
      return;
    }
    await withProgress(`Removing ${node.domain.domain}...`, async () => {
      await api.removeDomain(node.container!.id, node.domain!.id);
      domains.refresh();
    });
  });
}

async function runDeploy(
  api: BasicDeployApi,
  containers: ContainersProvider,
  containerId: string | undefined,
): Promise<void> {
  const session = await getSession(true);
  if (!session) {
    return;
  }
  const root = await pickWorkspaceFolder();
  if (!root) {
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "BasicDeploy" },
    async (progress) => {
      try {
        const outcome = await deployWorkspace(api, root, containerId, progress);
        containers.refresh();
        const open = "Open URL";
        const pick = await vscode.window.showInformationMessage(
          `Deployed ${outcome.subdomain || outcome.containerId}.`,
          ...(outcome.url ? [open] : []),
        );
        if (pick === open && outcome.url) {
          await vscode.env.openExternal(vscode.Uri.parse(outcome.url));
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Deploy failed: ${errorMessage(err)}`);
      }
    },
  );
}

async function withProgress(title: string, fn: () => Promise<void>): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title },
    async () => {
      try {
        await fn();
      } catch (err) {
        vscode.window.showErrorMessage(`BasicDeploy: ${errorMessage(err)}`);
      }
    },
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Ask the user whether to attach image files, then read the chosen files. The
// backend caps count and size and rejects non-images; we just gather them.
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function pickImages(prompt: string): Promise<UploadImage[]> {
  const attach = "Attach images";
  const choice = await vscode.window.showInformationMessage(prompt, attach, "No attachments");
  if (choice !== attach) {
    return [];
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: "Attach",
    filters: { Images: ["png", "jpg", "jpeg", "gif", "webp"] },
  });
  if (!uris || uris.length === 0) {
    return [];
  }
  const images: UploadImage[] = [];
  for (const uri of uris) {
    const bytes = await fs.readFile(uri.fsPath);
    const name = path.basename(uri.fsPath);
    const ext = path.extname(name).toLowerCase();
    images.push({
      name,
      contentType: IMAGE_CONTENT_TYPES[ext] ?? "application/octet-stream",
      bytes: new Uint8Array(bytes),
    });
  }
  return images;
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables registered in activate.
}
