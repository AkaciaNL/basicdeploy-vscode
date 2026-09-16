import * as vscode from "vscode";
import * as tar from "tar";
import { Readable } from "node:stream";
import { BasicDeployApi } from "./api";

// Directory names we never ship. Keeps the tarball small and avoids leaking
// local build junk or the local git history into the container.
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".vscode-test",
  "out",
  "dist",
  "build",
  "target",
  ".venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".gradle",
]);

// Package the given workspace folder into a gzipped tarball in memory.
export async function packWorkspace(root: vscode.Uri): Promise<Uint8Array> {
  const cwd = root.fsPath;
  const stream = tar.create(
    {
      gzip: true,
      cwd,
      // Drop ignored directories anywhere in the tree.
      filter: (p: string) => {
        const parts = p.split(/[\\/]/);
        return !parts.some((seg) => IGNORE_DIRS.has(seg));
      },
      portable: true,
    },
    ["."],
  ) as unknown as Readable;

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

// Pick the workspace folder to deploy. Prompts when there is more than one.
export async function pickWorkspaceFolder(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Open a folder to deploy first.");
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0].uri;
  }
  const pick = await vscode.window.showWorkspaceFolderPick({
    placeHolder: "Which folder do you want to deploy?",
  });
  return pick?.uri;
}

export interface DeployOutcome {
  containerId: string;
  subdomain: string;
  url: string;
}

// Core deploy: pack the folder, upload it, resolve the resulting container.
export async function deployWorkspace(
  api: BasicDeployApi,
  root: vscode.Uri,
  containerId: string | undefined,
  progress?: vscode.Progress<{ message?: string }>,
): Promise<DeployOutcome> {
  progress?.report({ message: "Packaging workspace..." });
  const tarball = await packWorkspace(root);

  progress?.report({ message: "Uploading and deploying..." });
  const resolvedId = await api.deploy(tarball, containerId);
  const id = resolvedId || containerId || "";

  let subdomain = "";
  if (id) {
    try {
      const c = await api.getContainer(id);
      subdomain = c.subdomain ?? "";
    } catch {
      // The deploy succeeded even if the follow-up lookup did not.
    }
  }
  return {
    containerId: id,
    subdomain,
    url: subdomain ? `https://${subdomain}.basicdeploy.com` : "",
  };
}
