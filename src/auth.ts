import * as vscode from "vscode";
import { BasicDeployApi } from "./api";

const SECRET_KEY = "basicdeploy.apiKey";
const SESSION_ID = "basicdeploy.session";
export const AUTH_PROVIDER_ID = "basicdeploy";

// API-key backed AuthenticationProvider. BasicDeploy issues long-lived API
// keys (stored plaintext server side by design), so a full OAuth dance would
// be overkill here. The user pastes a key once; we validate it against
// /auth/me and keep it in SecretStorage. This still gives the native VS Code
// "Sign in to BasicDeploy" account experience and the accounts menu entry.
export class BasicDeployAuthProvider implements vscode.AuthenticationProvider {
  private readonly _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: BasicDeployApi,
  ) {}

  async currentKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_KEY);
  }

  private async buildSession(key: string): Promise<vscode.AuthenticationSession> {
    let label = "BasicDeploy";
    try {
      const me = await this.api.whoami(key);
      if (me.email) {
        label = me.email;
      }
    } catch {
      // fall back to a generic label if the account lookup shape changes
    }
    return {
      id: SESSION_ID,
      accessToken: key,
      account: { id: label, label },
      scopes: [],
    };
  }

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const key = await this.currentKey();
    if (!key) {
      return [];
    }
    return [await this.buildSession(key)];
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    const open = "Open API keys page";
    const choice = await vscode.window.showInformationMessage(
      "Paste a BasicDeploy API key to sign in. You can create one in your account settings.",
      open,
      "I have a key",
    );
    if (choice === open) {
      await vscode.env.openExternal(vscode.Uri.parse("https://basicdeploy.com/settings"));
    }

    const key = await vscode.window.showInputBox({
      title: "BasicDeploy API key",
      prompt: "Paste your BasicDeploy API key",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "bd_...",
    });
    if (!key) {
      throw new Error("Sign in cancelled.");
    }

    // Reject bad keys before we store anything.
    await this.api.whoami(key.trim());

    await this.context.secrets.store(SECRET_KEY, key.trim());
    const session = await this.buildSession(key.trim());
    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
    return session;
  }

  async removeSession(): Promise<void> {
    const key = await this.currentKey();
    await this.context.secrets.delete(SECRET_KEY);
    if (key) {
      const removed = await this.buildSession(key);
      this._onDidChangeSessions.fire({ added: [], removed: [removed], changed: [] });
    }
  }

  dispose(): void {
    this._onDidChangeSessions.dispose();
  }
}

// Convenience: get a session, prompting sign-in when asked. Returns undefined
// if the user declines and createIfNone is false.
export async function getSession(
  createIfNone: boolean,
): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
    createIfNone,
  });
}
