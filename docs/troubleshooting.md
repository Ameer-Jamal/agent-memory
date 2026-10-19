# Troubleshooting

## The agent does not remember anything

Start a fresh chat. Run `agent-memory doctor`, open the listed instruction file, and confirm the managed block points to your memory folder. Complete the tool-specific steps in [compatibility](compatibility.md), then run `agent-memory test`.

A pointer is an instruction to read files; it does not automatically inject every note into context. Agents now use titles/keywords and bounded excerpts, not an automatic full index/policy read. Relevant topics and recent inbox notes are consulted as needed.

## Cursor does not discover the local rule

Run `agent-memory instructions cursor`. Paste that output into the app's global User Rules under Customize → Rules. Check the rule is enabled, start a fresh chat, and test again. Do not assume the desktop and CLI share account state or every rule mechanism.

## Codex ignores the pointer

Check `CODEX_HOME` and any `AGENTS.override.md` in that directory. Overrides can shadow the ordinary file; the installer warns rather than editing an override it does not own. Project rules can also alter behavior. Consult the official instruction-loading documentation linked in [compatibility](compatibility.md).

## Reading works but saving fails

This is often a file permission or sandbox boundary.

- Claude: opt into inbox-only capture with `setup --allow-capture`, or approve writes through the normal permission flow. Its path-scoped Write/Edit permissions use `Edit(...)` rules; a `Write(path)` rule does not enable the scoped file write. Managed deny/ask rules still take precedence.
- Codex: keep your normal sandbox. If the notebook is outside its writable workspace, add the inbox directory using `--add-dir` when starting a write-enabled session. Read-only sessions cannot save lessons.
- Antigravity: grant write access specifically to the notebook's inbox when prompted.
- Cursor: inspect the app's file access/trust prompts. The installer does not disable them.

The OS-user write check in `doctor` does not prove a sandboxed agent can write.

## CLI login or model errors

Agent Memory does not configure models or log in to providers. Resolve the error using the agent's normal setup. A desktop app can be signed in while its CLI is not, and a model name supported in one surface can fail in another. Do not change credentials or disable protections just to pass a memory test.

## Setup refuses an existing folder

Use a new subfolder. The installer refuses collisions with unrelated `MEMORY.md`, `INDEX.md`, or template files. Folders it previously created have a format marker and can be reconnected without overwriting existing notes. Do not add that marker to arbitrary folders to bypass the collision check.

## A managed block was edited

Move custom preferences outside the `agent-memory:managed` markers. Compare the block with `agent-memory instructions` and your local backups, then retry. The installer refuses to silently discard edits inside a block it owns.

## The installer was interrupted

Normal write failures trigger rollback of already-applied file contents. If another process changed an applied file, it is left alone and recovery paths are reported. Sudden process termination or power loss can interrupt this process; it is not a filesystem transaction across all files.

Backups and an index mapping backup files to original paths are under the installer state directory. Before retrying, inspect the files and restore only what is necessary. If an operation lock remains, first confirm the earlier process has stopped, then remove only the `operation.lock` directory mentioned in the error. Do not remove state casually; it records ownership for clean uninstall.

## Symlink or junction paths are refused

Use regular folders and config files. The installer intentionally refuses linked paths so an installation or cleanup cannot silently affect a different target. Manual setup is possible: inspect the generated pointer and add it through the tool's supported UI/config mechanism yourself.

## Uninstall left files or UI rules

Knowledge and backups are intentionally kept. Later unrelated config edits are preserved. Cursor's account User Rule and permission grants made in agent UIs must be removed there manually. Edited test notes are also kept rather than deleted. Run `test check` before cleanup to identify capture receipts.

## Notes are available locally but not in a cloud job

Provide an accessible copy to that runtime and configure its instruction entry point. Local paths cannot grant remote access. Agent Memory does not sync notes, mount folders, or manage provider storage.

## Report an issue safely

Include OS, Node version, CLI version, agent/version, command, and redacted diagnostics. Never upload your private memory, provider credentials, or config backups. Use a minimal synthetic reproduction when possible.

## OpenCode reports an expired key

An API key can expire independently of the memory integration. The live runner reports a failed read check and skips capture. Replace the key through that provider's normal console/setup, then retry; signing in again may not renew an expired API key. Agent Memory never replaces credentials or silently switches providers/models.

## Search found nothing, or says partial

Try two or three distinctive literal keywords from the symptom, title, or error. Keywords are AND-matched. Searches are deliberately bounded and may scan only part of a large collection. Follow a specific filename lead with local grep rather than dumping the notebook. No useful match is a signal to continue the task using current evidence, not to read every file.

## The GUI cannot select a folder

Paste the path into the field. Linux's optional native picker needs zenity. Existing-folder dialogs cannot create every kind of new nested path; select a parent, then append the new subfolder in the input. The installer creates it after preview.

## Live evidence is stale

The global instruction file or MEMORY.md changed after verification. Run a fresh challenge to establish current evidence. Configured, read-verified, and write-verified are separate states; a stale or failed check is not silently treated as success.
