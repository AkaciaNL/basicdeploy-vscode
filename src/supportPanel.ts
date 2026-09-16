import * as vscode from "vscode";
import { BasicDeployApi, TicketDetail } from "./api";
import { escapeHtml } from "./util";

// A support-ticket thread as a Webview: the message history plus a reply box
// and close/reopen actions. One panel per ticket number (reused on re-open).
export class SupportPanel {
  private static readonly panels = new Map<number, SupportPanel>();

  private readonly panel: vscode.WebviewPanel;

  static open(api: BasicDeployApi, onChange: () => void, number: number): void {
    const existing = SupportPanel.panels.get(number);
    if (existing) {
      existing.panel.reveal();
      void existing.load();
      return;
    }
    SupportPanel.panels.set(number, new SupportPanel(api, onChange, number));
  }

  private constructor(
    private readonly api: BasicDeployApi,
    private readonly onChange: () => void,
    private readonly number: number,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "basicdeploy.ticket",
      `Ticket #${number}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => SupportPanel.panels.delete(number));
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg?.type === "reply" && msg.body?.trim()) {
          await this.api.replyTicket(number, String(msg.body).trim());
          this.onChange();
          await this.load();
        } else if (msg?.type === "close") {
          await this.api.setTicketStatus(number, true);
          this.onChange();
          await this.load();
        } else if (msg?.type === "reopen") {
          await this.api.setTicketStatus(number, false);
          this.onChange();
          await this.load();
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Support action failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const detail = await this.api.getTicket(this.number);
      this.panel.title = `Ticket #${detail.number}`;
      this.panel.webview.html = render(detail);
    } catch (err) {
      this.panel.webview.html = shell(
        `Ticket #${this.number}`,
        `<p class="muted">Could not load ticket: ${escapeHtml(
          err instanceof Error ? err.message : String(err),
        )}</p>`,
      );
    }
  }
}

function shell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 14px 24px; }
    h2 { font-size: 14px; }
    .status { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .msg { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
    .who { font-weight: 600; font-size: 12px; }
    .when { color: var(--vscode-descriptionForeground); font-size: 11px; margin-left: 6px; }
    .body { white-space: pre-wrap; word-break: break-word; margin-top: 4px; font-size: 13px; }
    .muted { color: var(--vscode-descriptionForeground); }
    textarea { width: 100%; box-sizing: border-box; min-height: 80px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; font-family: inherit; }
    .bar { display: flex; gap: 8px; margin-top: 8px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 12px; border-radius: 3px; cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style></head><body>${body}</body></html>`;
}

function render(t: TicketDetail): string {
  const closed = t.status?.toLowerCase() === "closed";
  const messages = t.messages
    .map(
      (m) => `
      <div class="msg">
        <div><span class="who">${escapeHtml(m.author || "user")}</span><span class="when">${escapeHtml(m.createdAt || "")}</span></div>
        <div class="body">${escapeHtml(m.body || "")}</div>
      </div>`,
    )
    .join("");

  const composer = closed
    ? `<p class="muted">This ticket is closed.</p>
       <div class="bar"><button id="reopen" class="secondary">Reopen ticket</button></div>`
    : `<textarea id="reply" placeholder="Write a reply..."></textarea>
       <div class="bar">
         <button id="send">Send reply</button>
         <button id="close" class="secondary">Close ticket</button>
       </div>`;

  return shell(
    `Ticket #${t.number}`,
    `
    <h2>#${t.number} ${escapeHtml(t.subject)} <span class="status">${escapeHtml(t.status)}</span></h2>
    ${messages}
    <hr style="border-color: var(--vscode-panel-border); margin: 14px 0;">
    ${composer}
    <script>
      const vscode = acquireVsCodeApi();
      const send = document.getElementById('send');
      const close = document.getElementById('close');
      const reopen = document.getElementById('reopen');
      const reply = document.getElementById('reply');
      if (send) send.onclick = () => {
        const body = reply.value;
        if (body.trim()) { vscode.postMessage({ type: 'reply', body }); reply.value = ''; }
      };
      if (close) close.onclick = () => vscode.postMessage({ type: 'close' });
      if (reopen) reopen.onclick = () => vscode.postMessage({ type: 'reopen' });
    </script>`,
  );
}
