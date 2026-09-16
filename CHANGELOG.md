# Changelog

## 0.2.0

- Remote SSH into a container (managed SSH config include + per-container key, opens `/workspace`).
- Live log streaming (polled tail in an Output channel).
- Data view: per-container Postgres and object-storage connection details with copy actions.
- Domains view: list, add, and remove custom domains per container.
- Clean up the SSH host entry and key when a container is deleted.

## 0.1.0

Initial scaffold.

- Sign in with a BasicDeploy API key (AuthenticationProvider + SecretStorage).
- Containers activity-bar view: list, create, wake, sleep, delete, open URL, view logs.
- Deploy the current workspace to a new or existing container.
- Language Model Tools for Copilot agent mode: list containers, deploy workspace, read logs.
- `@basicdeploy` chat participant with `/deploy`, `/logs`, `/new`, `/list`.
