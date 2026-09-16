import * as vscode from "vscode";
import { BasicDeployApi, Container } from "./api";

// One row in the Containers tree. Carries the raw container so commands
// (wake, sleep, logs, open URL) can act on it directly.
export class ContainerItem extends vscode.TreeItem {
  constructor(public readonly container: Container) {
    super(container.subdomain || container.id, vscode.TreeItemCollapsibleState.None);
    const status = (container.status || "unknown").toLowerCase();
    this.description = status;
    // Status-specific context so the tree offers Wake only when asleep and
    // Sleep only when running. Common actions match on the bdContainer prefix.
    const asleep = status.includes("sleep") || status.includes("stop");
    this.contextValue = asleep ? "bdContainerSleeping" : "bdContainerRunning";
    this.tooltip = new vscode.MarkdownString(
      [
        `**${container.subdomain}**`,
        `status: ${status}`,
        `url: https://${container.subdomain}.basicdeploy.com`,
        container.alwaysOn ? "always on" : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    this.iconPath = new vscode.ThemeIcon(iconFor(status));
    this.resourceUri = vscode.Uri.parse(`https://${container.subdomain}.basicdeploy.com`);
  }
}

function iconFor(status: string): string {
  if (status.includes("run")) {
    return "vm-running";
  }
  if (status.includes("sleep") || status.includes("stop")) {
    return "vm-outline";
  }
  if (status.includes("error") || status.includes("fail")) {
    return "error";
  }
  return "vm";
}

export class ContainersProvider implements vscode.TreeDataProvider<ContainerItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ContainerItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ContainerItem[]> {
    try {
      const containers = await this.api.listContainers();
      return containers
        .sort((a, b) => (a.subdomain || "").localeCompare(b.subdomain || ""))
        .map((c) => new ContainerItem(c));
    } catch {
      // Signed out or API unreachable: show nothing, the welcome view guides
      // the user to sign in.
      return [];
    }
  }
}
