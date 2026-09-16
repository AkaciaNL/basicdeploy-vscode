import * as vscode from "vscode";
import { BasicDeployApi, TablePreview, TicketDetail } from "./api";

export const ROWS_SCHEME = "bd-rows";
export const TICKET_SCHEME = "bd-ticket";
const PAGE = 50;

// Read-only virtual document that shows a page of a table's rows as an aligned
// text table. A real editor tab, no webview. Paging updates the offset and
// re-renders the same document in place.
export class RowsDocProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private readonly offsets = new Map<string, number>();

  constructor(private readonly api: BasicDeployApi) {}

  private uriFor(table: string): vscode.Uri {
    return vscode.Uri.parse(`${ROWS_SCHEME}:/${encodeURIComponent(table)}.txt`);
  }
  private tableOf(uri: vscode.Uri): string {
    return decodeURIComponent(uri.path.replace(/^\//, "").replace(/\.txt$/, ""));
  }

  async open(table: string): Promise<void> {
    this.offsets.set(table, 0);
    const uri = this.uriFor(table);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    this.emitter.fire(uri);
  }

  // delta is in pages (+1 next, -1 prev), applied to the active rows document.
  page(delta: number): void {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== ROWS_SCHEME) {
      return;
    }
    const table = this.tableOf(ed.document.uri);
    const cur = this.offsets.get(table) ?? 0;
    this.offsets.set(table, Math.max(0, cur + delta * PAGE));
    this.emitter.fire(ed.document.uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const table = this.tableOf(uri);
    const offset = this.offsets.get(table) ?? 0;
    try {
      const preview = await this.api.rows(table, offset, PAGE);
      return renderRows(preview);
    } catch (err) {
      return `Could not load rows for ${table}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

function renderRows(p: TablePreview): string {
  const start = p.total === 0 ? 0 : p.offset + 1;
  const end = Math.min(p.offset + p.rows.length, p.total);
  const header =
    `Table: ${p.table}   rows ${start}-${end} of ${p.total}\n` +
    `Page with: BasicDeploy: Table Next Page / Table Previous Page (Command Palette)\n\n`;

  if (p.columns.length === 0) {
    return header + "(no columns)";
  }
  const cap = 40;
  const cell = (v: string | null): string => {
    const s = v === null || v === undefined ? "NULL" : String(v);
    const oneLine = s.replace(/\s+/g, " ");
    return oneLine.length > cap ? oneLine.slice(0, cap - 1) + "…" : oneLine;
  };
  const widths = p.columns.map((c, i) =>
    Math.max(c.length, ...p.rows.map((r) => cell(r[i]).length), 0),
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join(" | ");

  const out = [line(p.columns), widths.map((w) => "-".repeat(w)).join("-+-")];
  for (const row of p.rows) {
    out.push(line(p.columns.map((_, i) => cell(row[i]))));
  }
  return header + out.join("\n") + "\n";
}

// Read-only virtual document that shows a support ticket thread as markdown.
export class TicketDocProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  // Cache the last-rendered detail per ticket so the attachment picker can list
  // files without an extra fetch.
  private readonly cache = new Map<number, TicketDetail>();

  constructor(private readonly api: BasicDeployApi) {}

  uriFor(number: number): vscode.Uri {
    return vscode.Uri.parse(`${TICKET_SCHEME}:/ticket-${number}.md`);
  }
  numberOf(uri: vscode.Uri): number {
    const m = uri.path.match(/ticket-(\d+)\.md$/);
    return m ? Number(m[1]) : NaN;
  }

  async open(number: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(this.uriFor(number));
    await vscode.window.showTextDocument(doc, { preview: false });
    this.emitter.fire(this.uriFor(number));
  }

  refresh(number: number): void {
    this.emitter.fire(this.uriFor(number));
  }

  cached(number: number): TicketDetail | undefined {
    return this.cache.get(number);
  }

  // The ticket number for whichever ticket document is active, if any.
  activeNumber(): number | undefined {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== TICKET_SCHEME) {
      return undefined;
    }
    const n = this.numberOf(ed.document.uri);
    return Number.isNaN(n) ? undefined : n;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const number = this.numberOf(uri);
    try {
      const detail = await this.api.getTicket(number);
      this.cache.set(number, detail);
      return renderTicket(detail);
    } catch (err) {
      return `# Ticket #${number}\n\nCould not load: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

function renderTicket(t: TicketDetail): string {
  const lines: string[] = [
    `# Ticket #${t.number}: ${t.subject}`,
    "",
    `Status: **${t.status}**  ·  Updated: ${t.updatedAt}`,
    "",
    "Reply, close, or reopen from the editor title bar or the Support view.",
    "",
    "---",
    "",
  ];
  for (const m of t.messages) {
    lines.push(`### ${m.author || "user"}  ·  ${m.createdAt || ""}`);
    lines.push("");
    lines.push(m.body || "_(no text)_");
    if (m.attachments && m.attachments.length > 0) {
      lines.push("");
      lines.push("Attachments (open with: BasicDeploy: Open Ticket Attachment):");
      for (const a of m.attachments) {
        lines.push(`- ${a.filename}`);
      }
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}
