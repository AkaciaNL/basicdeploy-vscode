import * as vscode from "vscode";
import { BasicDeployApi, TableInfo } from "./api";
import { formatBytes } from "./util";

const PAGE = 100;

// One table (a leaf that opens the row browser) or a "Load more" action.
export class TableNode extends vscode.TreeItem {
  constructor(
    public readonly table?: TableInfo,
    public readonly loadMore?: boolean,
  ) {
    super(
      loadMore ? "Load more tables..." : table!.name,
      vscode.TreeItemCollapsibleState.None,
    );
    if (table) {
      this.contextValue = "bdTable";
      this.iconPath = new vscode.ThemeIcon("table");
      this.description = `${table.rowEstimate.toLocaleString()} rows · ${formatBytes(table.sizeBytes)}`;
      this.command = {
        command: "basicdeploy.openTable",
        title: "Open table",
        arguments: [table.name],
      };
    } else {
      this.iconPath = new vscode.ThemeIcon("ellipsis");
      this.command = { command: "basicdeploy.loadMoreTables", title: "Load more" };
    }
  }
}

// Lists the user's Postgres tables (offset-paginated). Selecting a table opens
// the in-editor row browser.
export class DatabaseProvider implements vscode.TreeDataProvider<TableNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private loaded: TableInfo[] = [];
  private total = 0;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this.loaded = [];
    this.total = 0;
    this._onDidChangeTreeData.fire();
  }

  async loadMore(): Promise<void> {
    try {
      const page = await this.api.tables(this.loaded.length, PAGE);
      this.loaded.push(...page.items);
      this.total = page.total;
      this._onDidChangeTreeData.fire();
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not load tables: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getTreeItem(element: TableNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TableNode): Promise<TableNode[]> {
    if (element) {
      return [];
    }
    if (this.loaded.length === 0) {
      try {
        const page = await this.api.tables(0, PAGE);
        this.loaded = page.items;
        this.total = page.total;
      } catch {
        return [];
      }
    }
    const nodes = this.loaded.map((t) => new TableNode(t));
    if (this.loaded.length === 0) {
      return [new TableNode(undefined, false)].map((n) => {
        n.label = "No tables yet";
        n.command = undefined;
        n.iconPath = new vscode.ThemeIcon("info");
        return n;
      });
    }
    if (this.loaded.length < this.total) {
      nodes.push(new TableNode(undefined, true));
    }
    return nodes;
  }
}
