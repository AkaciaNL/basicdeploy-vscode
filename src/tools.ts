import * as vscode from "vscode";
import { BasicDeployApi, findBySubdomain } from "./api";
import { deployWorkspace, pickWorkspaceFolder } from "./deploy";

// Native Language Model Tools. These let GitHub Copilot agent mode (and any
// other model host in VS Code) call BasicDeploy directly, without the user
// leaving chat. Each tool mirrors a manifest entry in package.json.

function text(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}

class ListContainersTool implements vscode.LanguageModelTool<Record<string, never>> {
  constructor(private readonly api: BasicDeployApi) {}

  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const containers = await this.api.listContainers();
    if (containers.length === 0) {
      return text("No containers yet.");
    }
    const lines = containers.map(
      (c) => `- ${c.subdomain} [${c.status}] https://${c.subdomain}.basicdeploy.com`,
    );
    return text(`Containers:\n${lines.join("\n")}`);
  }
}

interface DeployInput {
  subdomain?: string;
}

class DeployWorkspaceTool implements vscode.LanguageModelTool<DeployInput> {
  constructor(private readonly api: BasicDeployApi) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<DeployInput>,
  ): Promise<vscode.PreparedToolInvocation> {
    const target = options.input.subdomain
      ? `container ${options.input.subdomain}`
      : "a new container";
    return {
      invocationMessage: `Deploying the current workspace to ${target}`,
      confirmationMessages: {
        title: "Deploy to BasicDeploy",
        message: new vscode.MarkdownString(
          `Package this workspace and deploy it to **${target}**?`,
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DeployInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const root = await pickWorkspaceFolder();
    if (!root) {
      return text("No workspace folder is open to deploy.");
    }
    let containerId: string | undefined;
    if (options.input.subdomain) {
      const found = await findBySubdomain(this.api, options.input.subdomain);
      if (!found) {
        return text(`No container found with subdomain ${options.input.subdomain}.`);
      }
      containerId = found.id;
    }
    if (token.isCancellationRequested) {
      return text("Deploy cancelled.");
    }
    const outcome = await deployWorkspace(this.api, root, containerId);
    const where = outcome.url || "(url pending)";
    return text(`Deployed. Container ${outcome.subdomain || outcome.containerId} is live at ${where}`);
  }
}

interface LogsInput {
  subdomain: string;
  tail?: number;
}

class LogsTool implements vscode.LanguageModelTool<LogsInput> {
  constructor(private readonly api: BasicDeployApi) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<LogsInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const found = await findBySubdomain(this.api, options.input.subdomain);
    if (!found) {
      return text(`No container found with subdomain ${options.input.subdomain}.`);
    }
    const logs = await this.api.logs(found.id, options.input.tail ?? 200);
    return text(logs ? logs : "(no logs)");
  }
}

export function registerTools(
  context: vscode.ExtensionContext,
  api: BasicDeployApi,
): void {
  context.subscriptions.push(
    vscode.lm.registerTool("basicdeploy_list_containers", new ListContainersTool(api)),
    vscode.lm.registerTool("basicdeploy_deploy_workspace", new DeployWorkspaceTool(api)),
    vscode.lm.registerTool("basicdeploy_logs", new LogsTool(api)),
  );
}
