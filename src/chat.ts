import * as vscode from "vscode";
import { BasicDeployApi, findBySubdomain } from "./api";
import { deployWorkspace, pickWorkspaceFolder } from "./deploy";
import { getSession } from "./auth";

// The @basicdeploy chat participant. Handles slash commands (/deploy, /logs,
// /new, /list) and falls back to a short help reply for free text. It shares
// the same API client as the rest of the extension.
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  api: BasicDeployApi,
): void {
  const handler: vscode.ChatRequestHandler = async (request, _ctx, stream) => {
    const session = await getSession(true);
    if (!session) {
      stream.markdown("Sign in to BasicDeploy first (run **BasicDeploy: Sign In**).");
      return;
    }

    switch (request.command) {
      case "deploy":
        return handleDeploy(api, request, stream);
      case "logs":
        return handleLogs(api, request, stream);
      case "new":
        return handleNew(api, stream);
      case "list":
        return handleList(api, stream);
      default:
        stream.markdown(
          [
            "I can deploy and manage your BasicDeploy apps. Try:",
            "",
            "- `/deploy` deploy the current workspace",
            "- `/deploy <subdomain>` deploy into an existing container",
            "- `/logs <subdomain>` show recent logs",
            "- `/new` create a new container",
            "- `/list` list your containers",
          ].join("\n"),
        );
    }
  };

  const participant = vscode.chat.createChatParticipant("basicdeploy.chat", handler);
  participant.iconPath = new vscode.ThemeIcon("rocket");
  context.subscriptions.push(participant);
}

async function handleList(api: BasicDeployApi, stream: vscode.ChatResponseStream): Promise<void> {
  const containers = await api.listContainers();
  if (containers.length === 0) {
    stream.markdown("You have no containers yet. Use `/new` to create one.");
    return;
  }
  for (const c of containers) {
    stream.markdown(
      `- **${c.subdomain}** [${c.status}] https://${c.subdomain}.basicdeploy.com\n`,
    );
  }
}

async function handleNew(api: BasicDeployApi, stream: vscode.ChatResponseStream): Promise<void> {
  stream.progress("Creating a container...");
  const c = await api.createContainer();
  stream.markdown(
    `Created **${c.subdomain}**. Public URL: https://${c.subdomain}.basicdeploy.com`,
  );
}

async function handleDeploy(
  api: BasicDeployApi,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  const root = await pickWorkspaceFolder();
  if (!root) {
    stream.markdown("Open a folder to deploy first.");
    return;
  }
  const arg = request.prompt.trim();
  let containerId: string | undefined;
  if (arg) {
    const found = await findBySubdomain(api, arg);
    if (!found) {
      stream.markdown(`No container found with subdomain \`${arg}\`.`);
      return;
    }
    containerId = found.id;
  }
  stream.progress("Packaging and deploying...");
  const outcome = await deployWorkspace(api, root, containerId);
  const where = outcome.url || "(url pending)";
  stream.markdown(
    `Deployed. **${outcome.subdomain || outcome.containerId}** is live at ${where}`,
  );
}

async function handleLogs(
  api: BasicDeployApi,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  const arg = request.prompt.trim();
  if (!arg) {
    stream.markdown("Usage: `/logs <subdomain>`");
    return;
  }
  const found = await findBySubdomain(api, arg);
  if (!found) {
    stream.markdown(`No container found with subdomain \`${arg}\`.`);
    return;
  }
  stream.progress("Fetching logs...");
  const logs = await api.logs(found.id, 200);
  stream.markdown("```\n" + (logs || "(no logs)") + "\n```");
}
