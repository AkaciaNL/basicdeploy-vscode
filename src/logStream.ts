import * as vscode from "vscode";
import { BasicDeployApi, Container } from "./api";

// The backend exposes logs as a tail pull (GET /logs?tail=N), not a stream, so
// "live" logs are polled. For each streamed container we keep an OutputChannel
// and a timer; each poll fetches the tail and appends only the part we have not
// shown yet, computed by overlapping the previous tail with the new one.
interface Stream {
  channel: vscode.OutputChannel;
  timer: ReturnType<typeof setInterval>;
  last: string;
}

const TAIL = 400;
const INTERVAL_MS = 2000;

export class LogStreamer implements vscode.Disposable {
  private readonly streams = new Map<string, Stream>();

  constructor(private readonly api: BasicDeployApi) {}

  isStreaming(containerId: string): boolean {
    return this.streams.has(containerId);
  }

  toggle(container: Container): void {
    if (this.isStreaming(container.id)) {
      this.stop(container.id);
    } else {
      this.start(container);
    }
  }

  private start(container: Container): void {
    const channel = vscode.window.createOutputChannel(`BasicDeploy: ${container.subdomain}`);
    channel.show(true);
    channel.appendLine(`# streaming logs for ${container.subdomain} (poll every ${INTERVAL_MS / 1000}s)`);

    const stream: Stream = { channel, last: "", timer: undefined as unknown as ReturnType<typeof setInterval> };
    const poll = async () => {
      try {
        const text = await this.api.logs(container.id, TAIL);
        const delta = diffTail(stream.last, text);
        if (delta) {
          stream.channel.append(delta);
        }
        stream.last = text;
      } catch (err) {
        stream.channel.appendLine(`# log poll failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    stream.timer = setInterval(poll, INTERVAL_MS);
    this.streams.set(container.id, stream);
    void poll();
  }

  stop(containerId: string): void {
    const stream = this.streams.get(containerId);
    if (!stream) {
      return;
    }
    clearInterval(stream.timer);
    stream.channel.appendLine("\n# stopped streaming");
    this.streams.delete(containerId);
  }

  dispose(): void {
    for (const [, stream] of this.streams) {
      clearInterval(stream.timer);
      stream.channel.dispose();
    }
    this.streams.clear();
  }
}

// Return the portion of `next` that follows the content already shown in
// `prev`. Both are tails of the same log, so the new tail usually shares a
// suffix-overlap with the old one. If we cannot find an overlap (the log rolled
// past the tail window), fall back to showing the whole new tail.
function diffTail(prev: string, next: string): string {
  if (!prev) {
    return next;
  }
  if (next === prev) {
    return "";
  }
  if (next.startsWith(prev)) {
    return next.slice(prev.length);
  }
  // Find the longest suffix of prev that is a prefix of next.
  const max = Math.min(prev.length, next.length);
  for (let overlap = max; overlap > 0; overlap--) {
    if (prev.slice(prev.length - overlap) === next.slice(0, overlap)) {
      return next.slice(overlap);
    }
  }
  // No overlap: the window scrolled entirely. Show the new tail with a marker.
  return `\n# --- log window advanced ---\n${next}`;
}
