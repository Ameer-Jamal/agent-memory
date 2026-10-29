# Getting started

## Install

Install [Node.js 22+](https://nodejs.org/) and [Git](https://git-scm.com/downloads), then:

```sh
npm install --global git+https://github.com/Ameer-Jamal/agent-memory.git
agent-memory ui
```

This installs the package directly from GitHub. The package uses the official MCP SDK and Zod validation; there is no build step, API key, or hosted memory service to configure. Your selected agents need their own normal installation and login.

The graphical setup includes folder selection, agent checkboxes, previews, and connection status. See [GUI guide](gui.md). For a terminal wizard, run `agent-memory setup`.

Without a global installation:

```sh
npx --yes --package=github:Ameer-Jamal/agent-memory agent-memory setup
```

Use that same `npx --yes --package=github:Ameer-Jamal/agent-memory agent-memory` prefix in place of `agent-memory` for later commands.

## Choose where knowledge lives

The simplest choice is the default `~/AgentMemory`. It is a normal folder containing Markdown files; open it in any editor.

For Obsidian, choose a new folder *inside* your vault, for example `~/Notes/Agent Memory`. Registered vaults may be suggested. Obsidian is an editor for these files, not a required runtime.

If you already have other Markdown notes, the wizard can add a pointer to their folder. It does not import, copy, index, or upload those notes. The policy tells agents to search relevant notes only when the curated memory does not answer the task. Agent access to that folder remains subject to permissions.

Avoid choosing the root of an existing notebook that already has its own `INDEX.md` or `MEMORY.md`. The installer refuses to overwrite colliding files. Use a new subfolder instead. A folder previously created by this installer can be reconnected after uninstall; existing knowledge is preserved.

## Preview and apply

For a reproducible setup:

```sh
agent-memory setup --agents codex,claude --memory-dir "~/AgentMemory" --dry-run
agent-memory setup --agents codex,claude --memory-dir "~/AgentMemory" --yes
```

To opt into Claude's narrowly scoped permission for saving inbox Markdown:

```sh
agent-memory setup --agents claude --memory-dir "~/AgentMemory" --allow-capture --yes
```

Rerunning setup adds missing selected agents without duplicating existing blocks. It does not overwrite curated memory. If you change the notes source later, edit the shared policy deliberately; setup does not silently rewrite it. To move to another memory folder, uninstall, move/copy your notes deliberately, then set up the new path.

## Complete the connection

Run `agent-memory doctor` and follow the manual steps. In particular:

- **Cursor:** run `agent-memory instructions cursor`, copy its output, and paste it into the app's global User Rules under Customize → Rules. A local rule file is also created, but discovery varies by app version/surface; check the account rule explicitly.
- **Antigravity:** on first access, scope read permission to the memory folder and write permission to its `inbox` subfolder. Other notes sources may need separate approval.
- **Codex:** a read-only session cannot save notes. In a restricted CLI workspace, add the memory inbox as an additional writable directory using your normal sandbox settings. Do not disable the sandbox to make memory work.
- **Claude Code:** if you did not opt into the capture permission, approve an inbox write when requested. Existing deny/ask rules or managed policies can still block it.

Start fresh chats, then follow the [testing guide](testing.md).

## Everyday use

Give your agents normal tasks. The installed policy asks them to consult the index, search relevant lessons before repeated troubleshooting, and save reusable verified fixes or explicit user corrections.

To make a preference explicit:

> Remember this for future agents: in this project, use the documented local test command before running the full suite.

Add project scope and concrete commands when appropriate. A preference is user-stated; it is not evidence that a command has been tested.

Agents do not preload your notebook or index at startup. They search titles/keywords, read at most two short excerpts initially, and stop if nothing helps. See [retrieval design](retrieval.md).

No maintenance task is scheduled. Periodically ask an agent to review the inbox, consolidate useful lessons, update the index, and flag stale or contradictory advice.

## Remove or update

```sh
agent-memory uninstall --dry-run
agent-memory uninstall
```

Your knowledge files are kept. The installer removes its own unchanged blocks and optional Claude capture rule. Later unrelated edits are preserved. Remove the Cursor account User Rule and scoped permissions you added manually in agent UIs yourself. Backups remain private and local.

To update the CLI:

```sh
npm install --global git+https://github.com/Ameer-Jamal/agent-memory.git
```

An installer update does not overwrite your existing memory policy. Review release notes before changing policy or reconnecting tools.

## Run from source

```sh
git clone https://github.com/Ameer-Jamal/agent-memory.git
cd agent-memory
node bin/agent-memory.mjs setup
```

You can run `node bin/agent-memory.mjs` in place of the installed command. `npm ci` is only needed to follow the development/CI workflow; there are no third-party packages to download for the CLI itself.

## Installer state

State and backups are stored in `~/.config/agent-memory`. They can contain copies of your existing configuration, so keep them private. Notes live in the independently chosen memory folder.

Advanced: `AGENT_MEMORY_CONFIG_DIR` selects an alternate installer state directory. It does **not** redirect agent config files. Developers testing isolated homes should use the programmatic `context({home, configDir})` API or an isolated OS-user environment. Do not change this variable casually between installs; the original state is needed to preserve ownership during uninstall.

## Personal project connections

After setup, connect an existing project:

```sh
agent-memory project add --path "/path/to/project" --dry-run
agent-memory project add --path "/path/to/project"
agent-memory project list
agent-memory project remove --path "/path/to/project"
```

Only a small pointer is added to root AGENTS.md. The knowledge stays in the personal memory folder; this is not team knowledge sharing. Existing project instructions and later edits are preserved. New AGENTS.md pointers in ordinary Git checkouts get a local `.git/info/exclude` entry. Already-tracked instruction files and worktree metadata are not automatically ignored: review their diffs before committing. No global Git settings are changed.

## Upgrade a 0.1 policy

`agent-memory setup` refreshes owned instruction blocks. Existing policy files are otherwise kept. Use `agent-memory setup --upgrade-policy` to preview and explicitly replace MEMORY.md with the bounded retrieval policy; the previous file is backed up. Other notes remain intact.
