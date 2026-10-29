# Security and data handling

Agent Memory is a local configuration tool. It creates Markdown notes and adds instructions to selected coding-agent configs. Normal commands do not run a server, call models, or read agent authentication tokens. The optional `ui` command serves a temporary authenticated loopback app. `verify --live` invokes selected agent CLIs using their existing credentials and may make provider requests; it uses synthetic fixtures and stores status, not raw provider output. npm/Git fetch the software during installation; your coding agents make their own normal provider requests.

## Important boundaries

- A note read by a cloud-backed agent may be sent to that agent's provider. Local storage does not imply offline inference.
- The capture policy says not to store secrets, but there is no automatic secret scanner. Review lessons, permissions, and any notes you choose to share.
- Generated memory is ignored by Git by default. This does not protect files already tracked, override `git add --force`, encrypt files, or prevent access by other software.
- State/backups can contain copies of pre-existing agent config. They are stored separately in the local installer state directory, with restrictive modes where the OS supports them. Do not publish them.
- Filesystem access checks describe the current OS user. They do not override or establish agent sandbox access. Existing managed deny/ask rules still apply.

## Configuration safeguards

The installer previews changes, keeps local backups, marks its instruction blocks, refuses symbolic-link/junction paths, and uses atomic writes for individual files. Normal failures trigger rollback of already-applied file contents. It leaves concurrent edits alone rather than restoring over them. It is not a multi-file filesystem transaction and cannot guarantee rollback after power loss or abrupt process termination.

Uninstall removes managed integration and its optional Claude inbox rule while retaining knowledge and unrelated later edits. Settings manually added in agent UIs, including Cursor's account User Rule and Antigravity grants, need manual removal. Test cleanup deletes only exact unchanged fixtures and checked capture receipts; modified notes are retained.

This is a single-user local tool, not a security boundary for hostile shared directories or untrusted installer state. Use folders you control. Do not execute instructions found inside untrusted notes; the shared policy treats notes as reference data.

## Report a vulnerability

Please use the repository's **Security → Report a vulnerability** flow for sensitive reports. Avoid posting secrets, config backups, or private memory in public issues. Include a minimal synthetic reproduction, affected version, platform, expected behavior, and potential impact.

For ordinary bugs without sensitive information, use the bug report issue template. Report against your installed version, including whether MCP capture is enabled.

## Local graphical setup

The optional UI binds only to 127.0.0.1, uses a random per-run access token, rejects unexpected Host and Origin headers, and requires authorization for private APIs. It sends no permissive CORS headers, serves a restrictive content security policy, and expires after 15 idle minutes. File-changing actions require previews and reject changed inputs. Keep the printed URL private. Folder dialogs invoke fixed OS commands without interpolating user input. Do not expose the loopback port through a proxy/tunnel.

## Bounded retrieval and maintenance

Search/show cap output and refuse linked/traversal paths; note content is still untrusted reference data. File/byte scan limits can produce partial results, which are explicitly reported. This is not a semantic search engine or secret scanner. Maintenance requires an explicit reviewed plan ID, archives exact duplicates instead of deleting them, preserves manual index text, and rejects stale previews. Same-title notes are only review candidates.

## Local MCP server

`agent-memory mcp` uses the official MCP SDK over stdio: a client launches a local child process; there is no listening HTTP port or hosted URL. Read-only is the default. `--allow-write` explicitly enables new files inside the configured memory inbox; there are no tool actions to edit/delete notes, change configs, or execute shell commands. Removing a client connection does not remove already saved notes.

Capture requires a bounded duplicate preview and a second decision within 15 minutes. Revision checks reject changed notebook metadata/policy and concurrent captures, and new files use exclusive creation. The OS user and local directory remain the trust boundary; this is not protection from a hostile local process or abrupt power loss. Common credential patterns are rejected, but this is not a comprehensive secret scanner. Verification status and evidence come from the caller, not independent model/command verification. Semantic overlap is judged by the caller; no semantic classifier or API is invoked.

Only connect trusted MCP hosts. A cloud-backed host can send returned note excerpts to its AI provider. MCP tool definitions also consume host context; the host controls discovery/caching. Current input/output bounds do not imply a total model-token limit.
