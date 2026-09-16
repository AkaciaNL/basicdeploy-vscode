import * as vscode from "vscode";
import { BasicDeployApi, Container, DomainView } from "./api";

export class DomainNode extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly container?: Container,
    public readonly domain?: DomainView,
  ) {
    super(label, collapsible);
    if (container && !domain) {
      this.contextValue = "bdDomainContainer";
      this.iconPath = new vscode.ThemeIcon("globe");
    }
    if (domain) {
      this.contextValue = "bdDomainItem";
      this.description = domain.disabled ? "parked" : domain.status || "";
      this.iconPath = new vscode.ThemeIcon(domain.disabled ? "circle-slash" : "link");
      if (domain.lastError) {
        this.tooltip = domain.lastError;
      }
    }
  }
}

// Per-container custom domains (BYO Cloudflare / paid custom domains). Owners
// can add and remove domains from the tree.
export class DomainsProvider implements vscode.TreeDataProvider<DomainNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DomainNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DomainNode): Promise<DomainNode[]> {
    if (!element) {
      try {
        const containers = await this.api.listContainers();
        return containers
          .filter((c) => c.owner !== false)
          .sort((a, b) => (a.subdomain || "").localeCompare(b.subdomain || ""))
          .map(
            (c) => new DomainNode(c.subdomain, vscode.TreeItemCollapsibleState.Collapsed, c),
          );
      } catch {
        return [];
      }
    }
    const c = element.container;
    if (!c) {
      return [];
    }
    try {
      const domains = await this.api.listDomains(c.id);
      if (domains.length === 0) {
        return [new DomainNode("No custom domains", vscode.TreeItemCollapsibleState.None)];
      }
      return domains.map(
        (d) => new DomainNode(d.domain, vscode.TreeItemCollapsibleState.None, c, d),
      );
    } catch {
      return [new DomainNode("Could not load domains", vscode.TreeItemCollapsibleState.None)];
    }
  }
}
