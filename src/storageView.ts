import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { BasicDeployApi, ObjectInfo } from "./api";
import { formatBytes } from "./util";

const PAGE = 100;

export class ObjectNode extends vscode.TreeItem {
  constructor(
    public readonly object?: ObjectInfo,
    public readonly loadMore?: boolean,
  ) {
    super(
      loadMore ? "Load more objects..." : object!.key,
      vscode.TreeItemCollapsibleState.None,
    );
    if (object) {
      this.contextValue = "bdObject";
      this.iconPath = new vscode.ThemeIcon("file");
      this.description = `${formatBytes(object.size)} · ${object.lastModified}`;
      this.tooltip = object.key;
      this.command = {
        command: "basicdeploy.openObject",
        title: "Open object",
        arguments: [object.key],
      };
    } else {
      this.iconPath = new vscode.ThemeIcon("ellipsis");
      this.command = { command: "basicdeploy.loadMoreObjects", title: "Load more" };
    }
  }
}

// Lists the user's object-storage bucket (cursor-paginated). Selecting an
// object opens its content in the editor.
export class StorageProvider implements vscode.TreeDataProvider<ObjectNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private loaded: ObjectInfo[] = [];
  private nextAfter: string | undefined;
  private done = false;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this.loaded = [];
    this.nextAfter = undefined;
    this.done = false;
    this._onDidChangeTreeData.fire();
  }

  async loadMore(): Promise<void> {
    try {
      const page = await this.api.objects(this.nextAfter, PAGE);
      this.loaded.push(...page.items);
      this.nextAfter = page.nextAfter ?? undefined;
      this.done = !this.nextAfter;
      this._onDidChangeTreeData.fire();
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not load objects: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getTreeItem(element: ObjectNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ObjectNode): Promise<ObjectNode[]> {
    if (element) {
      return [];
    }
    if (this.loaded.length === 0 && !this.done) {
      try {
        const page = await this.api.objects(undefined, PAGE);
        this.loaded = page.items;
        this.nextAfter = page.nextAfter ?? undefined;
        this.done = !this.nextAfter;
      } catch {
        return [];
      }
    }
    if (this.loaded.length === 0) {
      const empty = new ObjectNode(undefined, false);
      empty.label = "No objects yet";
      empty.command = undefined;
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }
    const nodes = this.loaded.map((o) => new ObjectNode(o));
    if (!this.done) {
      nodes.push(new ObjectNode(undefined, true));
    }
    return nodes;
  }
}

// Fetch an object's bytes, write them to a temp file under global storage, and
// open it with the built-in editor/viewer (text, image, pdf all handled).
export async function openObject(
  context: vscode.ExtensionContext,
  api: BasicDeployApi,
  key: string,
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Opening ${key}...` },
    async () => {
      const { bytes } = await api.getObject(key);
      const dir = path.join(context.globalStorageUri.fsPath, "objects");
      await fs.mkdir(dir, { recursive: true });
      // Preserve the base filename (and extension) so VS Code picks the viewer.
      const base = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
      const safe = base.replace(/[^A-Za-z0-9._-]/g, "_") || "object";
      const filePath = path.join(dir, safe);
      await fs.writeFile(filePath, bytes);
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath));
    },
  );
}
