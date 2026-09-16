import * as vscode from "vscode";
import { BasicDeployApi, TicketSummary } from "./api";

export class TicketNode extends vscode.TreeItem {
  constructor(public readonly ticket?: TicketSummary) {
    super(
      ticket ? `#${ticket.number} ${ticket.subject}` : "No support tickets",
      vscode.TreeItemCollapsibleState.None,
    );
    if (ticket) {
      const closed = ticket.status?.toLowerCase() === "closed";
      this.contextValue = closed ? "bdTicketClosed" : "bdTicketOpen";
      this.description = ticket.status + (ticket.lastReplyBy ? ` · ${ticket.lastReplyBy}` : "");
      this.iconPath = new vscode.ThemeIcon(closed ? "check" : "comment-discussion");
      this.tooltip = `#${ticket.number} ${ticket.subject}\nstatus: ${ticket.status}\nupdated: ${ticket.updatedAt}`;
      this.command = {
        command: "basicdeploy.openTicket",
        title: "Open ticket",
        arguments: [ticket.number],
      };
    } else {
      this.iconPath = new vscode.ThemeIcon("info");
    }
  }
}

// Lists the signed-in user's support tickets. Selecting one opens the thread.
export class SupportProvider implements vscode.TreeDataProvider<TicketNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly api: BasicDeployApi) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TicketNode): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<TicketNode[]> {
    let tickets: TicketSummary[];
    try {
      tickets = await this.api.listTickets();
    } catch {
      return [];
    }
    if (tickets.length === 0) {
      // Empty: let the view's welcome content ("New support ticket") show.
      return [];
    }
    return tickets
      .slice()
      .sort((a, b) => b.number - a.number)
      .map((t) => new TicketNode(t));
  }
}
