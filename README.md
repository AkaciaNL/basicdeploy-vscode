# BasicDeploy for VS Code

Deploy and manage your BasicDeploy apps without leaving VS Code. Ship the current workspace in one click, browse containers, databases, object storage and Kafka, stream logs, open a public URL, and SSH straight into your box. Native GitHub Copilot tools and an `@basicdeploy` chat participant let the agent build, deploy and debug for you.

## Features

- **Sign in with a BasicDeploy API key.** A native VS Code account entry, stored in SecretStorage.
- **Containers view.** See every container with its status and public URL. Create, wake, sleep, delete, open the URL, and read logs from the activity bar.
- **One-click deploy.** `BasicDeploy: Deploy Current Workspace` packages the open folder (skipping `node_modules`, `.git`, build output) and ships it. Deploy into a new container or an existing one.
- **GitHub Copilot tools.** `basicdeploy_list_containers`, `basicdeploy_deploy_workspace`, and `basicdeploy_logs` are exposed as Language Model Tools, so Copilot agent mode can deploy and debug on your behalf.
- **`@basicdeploy` chat participant.** In the Chat view, type `@basicdeploy` then `/deploy`, `/logs <subdomain>`, `/new`, or `/list`.
- **Remote SSH.** Open a container in a Remote-SSH window (or the `/workspace` folder). The extension writes a managed SSH config entry and per-container key; nothing in your own `~/.ssh/config` is overwritten.
- **Live log streaming.** Tail a container's logs in an Output channel that refreshes every couple of seconds.
- **Data view.** Per-container Postgres and object-storage connection details, one click to copy.
- **Domains view.** See, add, and remove custom domains per container.

## Getting started

1. Install the extension.
2. Run **BasicDeploy: Sign In** (or open the BasicDeploy view and click sign in).
3. Paste an API key from your [account settings](https://basicdeploy.com/settings).
4. Open a project folder and run **BasicDeploy: Deploy Current Workspace**.

## Configuration

- `basicdeploy.apiUrl` (default `https://basicdeploy.com/api`) base URL of the REST API. Point it at a self-hosted instance if needed.

## Building from source

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

## Roadmap

- Kafka view and topic browsing.
- In-editor data browsing (rows and objects), not just connection details.
- Marketplace and Open VSX listings, plus the MCP server in the GitHub MCP Registry.

## License

MIT. See [LICENSE](./LICENSE).
