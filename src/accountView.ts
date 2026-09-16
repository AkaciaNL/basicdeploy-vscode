import * as vscode from "vscode";
import { BasicDeployApi, Me } from "./api";
import { formatBytes } from "./util";

class InfoNode extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string, warn = false) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.tooltip = `${label}: ${value}`;
    this.iconPath = new vscode.ThemeIcon(
      icon,
      warn ? new vscode.ThemeColor("errorForeground") : undefined,
    );
    this.contextValue = "bdAccountInfo";
  }
}

// Shows the signed-in account's plan, limits, and current usage so the user can
// see where they stand before they hit a cap.
export class AccountProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    let me: Me;
    let containerCount = 0;
    try {
      [me, containerCount] = await Promise.all([
        this.api.me(),
        this.api.listContainers().then((c) => c.length).catch(() => 0),
      ]);
    } catch {
      return [];
    }

    const nodes: vscode.TreeItem[] = [];
    const price = me.plan.priceMonthlyUsd ? ` ($${me.plan.priceMonthlyUsd}/mo)` : "";
    nodes.push(new InfoNode("Plan", `${me.plan.displayName}${price}`, "star-full"));

    if (me.compedUntil) {
      nodes.push(new InfoNode("Comped until", me.compedUntil.slice(0, 10), "gift"));
    }

    nodes.push(
      new InfoNode(
        "Containers",
        `${containerCount} / ${me.plan.effectiveMaxContainers}`,
        "server",
        containerCount >= me.plan.effectiveMaxContainers,
      ),
    );

    if (me.containerAddons > 0 || me.plan.alwaysOnIncluded === false) {
      nodes.push(
        new InfoNode("Always-on slots", `${me.alwaysOnUsed} / ${me.containerAddons}`, "pulse"),
      );
    }

    const disk = me.usage.diskBytes ?? null;
    const limit = me.usage.storageLimitBytes ?? me.plan.maxStorageBytes;
    const diskLabel = disk === null ? "not measured yet" : `${formatBytes(disk)} / ${formatBytes(limit)}`;
    nodes.push(
      new InfoNode("Storage", diskLabel, "database", disk !== null && disk >= limit),
    );

    if (me.usage.databaseBytes != null) {
      nodes.push(new InfoNode("Database size", formatBytes(me.usage.databaseBytes), "symbol-field"));
    }

    nodes.push(new InfoNode("Memory per container", `up to ${formatBytes(me.plan.maxMemoryBytes)}`, "chip"));
    nodes.push(new InfoNode("Custom domains", `up to ${me.plan.maxCustomDomains}`, "globe"));

    if (me.overQuota) {
      nodes.push(
        new InfoNode(
          "Over quota",
          me.overQuotaReason || "creates and wakes are paused",
          "warning",
          true,
        ),
      );
    }

    return nodes;
  }
}
