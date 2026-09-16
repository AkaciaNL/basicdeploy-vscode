# Changelog

## 0.5.2

- Signed-out UX: every view now shows a "Sign in to BasicDeploy" prompt when there is no key, driven by a basicdeploy.signedIn context key, instead of rendering empty.
- Containers view no longer tells a signed-in user to sign in when they simply have no containers; it offers Deploy / New container instead. Support view offers New ticket when empty.


## 0.5.1

- Fixed Sign Out: it now actually clears the stored API key (was a no-op that only pointed at the Accounts menu).
- README logo uses an absolute HTTPS PNG (the Marketplace rejects SVG and relative image paths).
- Dropped the incorrect "Azure" Marketplace category.


## 0.5.0

- Replaced the row browser and ticket thread webviews with native read-only editor documents (bd-rows and bd-ticket schemes): tables render as aligned text, tickets as markdown. Paging and ticket actions live in the editor title bar.
- Support ticket attachments: attach images when creating a ticket or replying, and open a ticket's attachments from the editor.


## 0.4.0

- Support view: list your support tickets, open a ticket thread in the editor, reply, and close or reopen it. New Support Ticket action creates one (subject + body).
- Publisher set to akacianl (extension id akacianl.basicdeploy).
- Added .vscode launch + tasks so F5 runs the Extension Development Host out of the box.


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
