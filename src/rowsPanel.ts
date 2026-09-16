import * as vscode from "vscode";
import { BasicDeployApi, TablePreview } from "./api";
import { escapeHtml } from "./util";

const PAGE = 50;

// In-editor row browser: a Webview panel that renders a page of a table's rows
// as an HTML table with prev/next paging. One panel per table (reused on
// re-open). Read-only, matching the backend's read-only preview endpoint.
export class RowsPanel {
  private static readonly panels = new Map<string, RowsPanel>();

  private readonly panel: vscode.WebviewPanel;
  private offset = 0;

  static open(api: BasicDeployApi, table: string): void {
    const existing = RowsPanel.panels.get(table);
    if (existing) {
      existing.panel.reveal();
      void existing.load(existing.offset);
      return;
    }
    RowsPanel.panels.set(table, new RowsPanel(api, table));
  }

  private constructor(
    private readonly api: BasicDeployApi,
    private readonly table: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "basicdeploy.rows",
      `Table: ${table}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => RowsPanel.panels.delete(table));
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "page") {
        void this.load(Math.max(0, Number(msg.offset) || 0));
      }
    });
    void this.load(0);
  }

  private async load(offset: number): Promise<void> {
    this.offset = offset;
    this.panel.webview.html = renderLoading(this.table);
    try {
      const preview = await this.api.rows(this.table, offset, PAGE);
      this.offset = preview.offset;
      this.panel.webview.html = renderTable(preview);
    } catch (err) {
      this.panel.webview.html = renderError(
        this.table,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

function shell(table: string, body: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 12px 24px; }
  h2 { font-size: 13px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; white-space: pre-wrap; word-break: break-word; }
  th { position: sticky; top: 0; background: var(--vscode-editor-background); }
  tr:nth-child(even) td { background: var(--vscode-list-hoverBackground); }
  .bar { display: flex; gap: 8px; align-items: center; margin: 10px 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 3px; }
  button:disabled { opacity: .4; cursor: default; }
  .muted { color: var(--vscode-descriptionForeground); }
  .null { color: var(--vscode-descriptionForeground); font-style: italic; }
</style></head>
<body><h2>${escapeHtml(table)}</h2>${body}</body></html>`;
}

function renderLoading(table: string): string {
  return shell(table, `<p class="muted">Loading...</p>`);
}

function renderError(table: string, message: string): string {
  return shell(table, `<p class="muted">Could not load rows: ${escapeHtml(message)}</p>`);
}

function renderTable(p: TablePreview): string {
  const start = p.total === 0 ? 0 : p.offset + 1;
  const end = Math.min(p.offset + p.rows.length, p.total);
  const head = p.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = p.rows
    .map(
      (row) =>
        "<tr>" +
        row
          .map((cell) =>
            cell === null || cell === undefined
              ? `<td class="null">null</td>`
              : `<td>${escapeHtml(String(cell))}</td>`,
          )
          .join("") +
        "</tr>",
    )
    .join("");
  const prevOffset = Math.max(0, p.offset - p.limit);
  const nextOffset = p.offset + p.limit;
  const hasPrev = p.offset > 0;
  const hasNext = nextOffset < p.total;

  return shell(
    p.table,
    `
    <div class="bar">
      <button id="prev" ${hasPrev ? "" : "disabled"}>Prev</button>
      <button id="next" ${hasNext ? "" : "disabled"}>Next</button>
      <span class="muted">rows ${start}-${end} of ${p.total.toLocaleString()}</span>
    </div>
    <div style="overflow:auto; max-height: calc(100vh - 120px);">
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      const p = document.getElementById('prev');
      const n = document.getElementById('next');
      if (p) p.onclick = () => vscode.postMessage({ type: 'page', offset: ${prevOffset} });
      if (n) n.onclick = () => vscode.postMessage({ type: 'page', offset: ${nextOffset} });
    </script>`,
  );
}
