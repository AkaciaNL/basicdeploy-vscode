# Changelog

## 0.3.0

- Split the data surface into three views matching the web console: Database, Storage, Kafka.
- Database view: list Postgres tables (paged), open a table in an in-editor row browser with prev/next paging.
- Storage view: list bucket objects (cursor-paged), open an object (text/image/pdf) in the editor.
- Kafka view: list topics with usage; create, purge, and delete topics.
- Copy connection info (Postgres, S3, Kafka credentials) to the clipboard from the Database view.

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
