<p align="center"><img src="./logo.svg" width="96" alt="BasicDeploy"></p>

# BasicDeploy for VS Code

**Deploy and manage the persistent runtime your agent ships to (a database, object storage, a Kafka broker, and a public URL) without leaving your editor.**

A first-class VS Code extension for [BasicDeploy](https://basicdeploy.com). Ship the current workspace in one click, browse your containers, Postgres tables, object storage and Kafka topics, stream logs, open a public URL, and SSH straight into your box. It also exposes native [GitHub Copilot](https://code.visualstudio.com/docs/copilot/overview) tools and an `@basicdeploy` chat participant, so the agent can build, deploy and debug on BasicDeploy for you, right inside the Chat view. Every container comes with a PostgreSQL database, S3-compatible object storage, a Kafka broker, environment variables, and a public HTTPS URL, all provisioned automatically.

- Site: https://basicdeploy.com
- Marketplace: https://marketplace.visualstudio.com/items?itemName=akacianl.basicdeploy
- Docs: https://basicdeploy.com/docs
- MCP server (any agent): https://github.com/AkaciaNL/basicdeploy-mcp

## Quick start

1. Install **BasicDeploy** from the Marketplace (or Open VSX).
2. Run **BasicDeploy: Sign In** from the Command Palette, or open the BasicDeploy view in the activity bar and click sign in.
3. Paste an API key from **https://basicdeploy.com/api-keys** (it looks like `bd_...`, shown once). It is stored in VS Code SecretStorage, never in a file.
4. Open a project folder and run **BasicDeploy: Deploy Current Workspace**. The extension packs the folder, ships it, and hands you the public URL.

## Features

- **Sign in with a BasicDeploy API key.** A native VS Code account entry, backed by SecretStorage.
- **One-click deploy.** Package the open folder (skipping `node_modules`, `.git`, and build output) and deploy it to a new container, or into an existing one.
- **Containers view.** Every container with its status and public URL: create, wake, sleep, delete, open the URL, view logs, deploy into, or SSH in.
- **Database view.** Browse your Postgres tables and page through rows in an in-editor viewer. Copy full connection info in one click.
- **Storage view.** Browse your object-storage bucket and open any object (text, image, or PDF) right in the editor.
- **Kafka view.** See your topics with partitions and usage; create, purge, or delete them.
- **Domains view.** List, add, and remove custom domains per container.
- **Support view.** Create a support ticket (with image attachments), read the thread as a document, reply, open attachments, and close or reopen, all in native editor tabs (no webviews).
- **Live log streaming.** Tail a container's logs in an Output channel that refreshes every couple of seconds.
- **Remote SSH.** Open a container in a Remote-SSH window (or its `/workspace` folder) for full cloud development.

## GitHub Copilot integration

The extension registers native Language Model Tools, so Copilot agent mode (and any model host in VS Code) can operate BasicDeploy directly:

| Tool | Arguments | Description |
|---|---|---|
| `basicdeploy_list_containers` | (none) | List your containers with status and public URL. |
| `basicdeploy_deploy_workspace` | `subdomain?` | Package the current workspace and deploy it. Omit `subdomain` to create a new container; pass one to deploy into an existing container. Returns the public URL. |
| `basicdeploy_logs` | `subdomain`, `tail?` | Read a container's recent logs to diagnose a failing app. |

It also contributes an **`@basicdeploy` chat participant**. In the Chat view, type `@basicdeploy` then:

| Command | Description |
|---|---|
| `/deploy [subdomain]` | Deploy the current workspace (to a new container, or the named one). |
| `/logs <subdomain>` | Show a container's recent logs. |
| `/new` | Create a new container. |
| `/list` | List your containers. |

## Views

| View | What it does |
|---|---|
| Containers | Create, deploy into, wake, sleep, delete, open URL, view/stream logs, SSH. |
| Database | List Postgres tables; open a table in the paged row browser; copy connection info. |
| Storage | List bucket objects; open an object in the editor. |
| Kafka | List topics with usage; create, purge, delete. |
| Domains | List, add, and remove custom domains. |
| Support | Create a ticket (with attachments), read/reply to the thread, open attachments, close or reopen. |

## Remote SSH

**BasicDeploy: Open Remote SSH** (on any container) writes a per-container key and a managed `~/.ssh/basicdeploy_config` `Host` entry, then hands off to the Remote-SSH extension. Your own `~/.ssh/config` is never overwritten: one `Include` line is added, and everything BasicDeploy owns lives in the managed file (cleaned up when you delete the container). Connections reach the bastion at `ssh.basicdeploy.com:2222` with your container's subdomain as the username, landing you in `/workspace`.

## Runtime

Deployed apps must listen on `0.0.0.0:8080`, the port the public URL serves. `DATABASE_URL`, `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET`, and `KAFKA_BOOTSTRAP` / `KAFKA_USERNAME` / `KAFKA_PASSWORD` / `KAFKA_GROUP_PREFIX` are preset in the container environment.

## Configuration

- `basicdeploy.apiUrl` (default `https://basicdeploy.com/api`): base URL of the REST API. Point it at a self-hosted instance if needed.

## Example prompts

Ask Copilot (with the BasicDeploy tools enabled) or `@basicdeploy`:

- "Deploy this workspace and give me the URL."
- "Deploy the current folder into my `blue-fox` container."
- "Show the last 100 log lines of `blue-fox`."
- "List my containers and which ones are asleep."

## Building and testing from source

```bash
npm install
npm run compile
```

**Run it (F5).** Open this folder in VS Code and press `F5` (Run Extension). That
compiles and launches a second VS Code window, the Extension Development Host,
with the extension loaded. Sign in with an API key and try the views, deploy,
and chat. `npm run watch` keeps recompiling while you iterate; use the Reload
command in the dev host to pick up changes.

**Package a VSIX and install it.** To test the packaged build the way a user
would install it:

```bash
npm install -g @vscode/vsce
vsce package                       # produces basicdeploy-<version>.vsix
code --install-extension basicdeploy-*.vsix
```

**Point at another backend.** Set `basicdeploy.apiUrl` in Settings to test
against staging or a local instance instead of https://basicdeploy.com/api.

## Roadmap

- Message browsing for Kafka topics.
- Editing (not just read-only viewing) of rows and objects.
- Marketplace and Open VSX listings, plus the MCP server in the GitHub MCP Registry.

## License

MIT. BasicDeploy is a product of Akacia (KVK 99629569, Netherlands).
