import * as vscode from "vscode";
import { BasicDeployApi, Container } from "./api";

// A copyable connection detail (a leaf) or a container grouping node.
export class DataNode extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly container?: Container,
    public readonly copyValue?: string,
    icon?: string,
  ) {
    super(label, collapsible);
    if (copyValue) {
      this.contextValue = "bdDataItem";
      this.tooltip = copyValue;
      this.description = truncate(copyValue);
    }
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

function truncate(value: string, max = 48): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

// Shows each container's Postgres and object-storage connection details, with
// copy actions. Full row/object browsing lives in the web console; the point
// here is one-click access to the credentials your code needs.
export class DataProvider implements vscode.TreeDataProvider<DataNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DataNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DataNode): Promise<DataNode[]> {
    if (!element) {
      try {
        const containers = await this.api.listContainers();
        return containers
          .filter((c) => c.owner !== false)
          .sort((a, b) => (a.subdomain || "").localeCompare(b.subdomain || ""))
          .map(
            (c) =>
              new DataNode(
                c.subdomain,
                vscode.TreeItemCollapsibleState.Collapsed,
                c,
                undefined,
                "database",
              ),
          );
      } catch {
        return [];
      }
    }

    // A container is expanded: resolve its full record for the credentials,
    // which the list endpoint may omit.
    const c = element.container;
    if (!c) {
      return [];
    }
    let full = c;
    try {
      full = await this.api.getContainer(c.id);
    } catch {
      // fall back to whatever the list gave us
    }
    const nodes: DataNode[] = [];
    if (full.databaseUrl) {
      nodes.push(leaf("Postgres URL", full.databaseUrl, "link"));
    }
    if (full.dbName) {
      nodes.push(leaf("Database", full.dbName, "symbol-field"));
    }
    if (full.s3Endpoint) {
      nodes.push(leaf("S3 endpoint", full.s3Endpoint, "cloud"));
    }
    if (full.s3Bucket) {
      nodes.push(leaf("S3 bucket", full.s3Bucket, "archive"));
    }
    if (full.s3AccessKey) {
      nodes.push(leaf("S3 access key", full.s3AccessKey, "key"));
    }
    if (full.s3SecretKey) {
      nodes.push(leaf("S3 secret key", full.s3SecretKey, "key"));
    }
    if (nodes.length === 0) {
      nodes.push(new DataNode("No data services", vscode.TreeItemCollapsibleState.None));
    }
    return nodes;
  }
}

function leaf(label: string, value: string, icon: string): DataNode {
  return new DataNode(label, vscode.TreeItemCollapsibleState.None, undefined, value, icon);
}
