import * as vscode from "vscode";
import { BasicDeployApi } from "./api";
import { AUTH_PROVIDER_ID, BasicDeployAuthProvider, getSession } from "./auth";
import { ContainerItem, ContainersProvider } from "./containersView";
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
  const tree = vscode.window.createTreeView("basicdeploy.containers", {
    treeDataProvider: containers,
  });
  context.subscriptions.push(tree);

  // Refresh the tree whenever the account changes.
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === AUTH_PROVIDER_ID) {
        containers.refresh();
      }
    }),
  );

  registerTools(context, api);
  registerChatParticipant(context, api);
  registerCommands(context, api, containers);

  // Prime the view if already signed in.
  containers.refresh();
}

function registerCommands(
  context: vscode.ExtensionContext,
  api: BasicDeployApi,
  containers: ContainersProvider,
): void {
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("basicdeploy.signIn", async () => {
    await getSession(true);
    containers.refresh();
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

  reg("basicdeploy.createContainer", async () => {
    await withProgress("Creating container...", async () => {
      const c = await api.createContainer();
      vscode.window.showInformationMessage(
        `Created ${c.subdomain} at https://${c.subdomain}.basicdeploy.com`,
      );
      containers.refresh();
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
      containers.refresh();
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
      const logs = await api.logs(item.container.id, 500);
      output.clear();
      output.appendLine(`# logs: ${item.container.subdomain}`);
      output.appendLine(logs || "(no logs)");
      output.show(true);
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

export function deactivate(): void {
  // Nothing to clean up beyond the disposables registered in activate.
}
