<p align="center">
  <img src="docs/assets/overview.svg" alt="Agent Memory: one shared Markdown notebook connecting eight coding agents through small, bounded lookups" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Ameer-Jamal/agent-memory/actions/workflows/ci.yml"><img src="https://github.com/Ameer-Jamal/agent-memory/actions/workflows/ci.yml/badge.svg" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-5c9778" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-5c9778" alt="Node.js 22 or newer">
  <img src="https://img.shields.io/badge/runtime_dependencies-0-6a7dbe" alt="Zero runtime dependencies">
</p>

# Agent Memory

**Learn once. Reuse across agents.**

Give your coding agents a shared Markdown notebook for fixes, preferences, and procedures. When you switch tools or start a fresh chat, useful discoveries have somewhere to live.

Connect **Claude Code, Codex, Cursor, Antigravity, OpenCode, GitHub Copilot CLI, Windsurf/Cascade, and Cline** through their supported instruction files. Use a regular folder, your existing Markdown notes, or an Obsidian vault. No Obsidian plugin is required.

[Get started](#get-started) · [See how it works](#how-it-works) · [Compatibility](docs/compatibility.md) · [Troubleshooting](docs/troubleshooting.md) · [Contribute](CONTRIBUTING.md)

## Why use it?

You solve a tricky local setup issue with one agent. Tomorrow, another agent hits the same error and starts from scratch. Or you repeat the same preference in every new chat.

Agent Memory gives that knowledge a home and adds short instructions telling each agent **when to look it up and when to save a lesson**.

| Without shared notes | With Agent Memory |
| --- | --- |
| Explain the same setup across tools | Point selected agents at one notebook |
| Rediscover the same environment fix | Keep the symptom, scope, fix, and evidence |
| Lose useful corrections in long chats | Save concise, searchable lessons |
| Copy a huge instruction file everywhere | Search titles, then read a matching excerpt |
| Wonder whether memory works | Run an explicit discovery and capture test |

For example: an agent discovers that a local test runner needs a particular Java version. It records the symptom, confirmed fix, project scope, and verification. A future agent can find the note before trying the same failing command.

**This is file-based memory, not model training.** Following the instructions depends on the agent, its version, and its permissions. The installer checks configuration; the guided test checks actual behavior.

## Get started

You need **[Node.js 22+](https://nodejs.org/)** and **[Git](https://git-scm.com/downloads)**. The installer has no runtime dependencies. Your chosen coding agents still need to be installed and signed in separately.

```sh
npm install --global git+https://github.com/Ameer-Jamal/agent-memory.git
agent-memory ui
```

The package is installed directly from this GitHub repo; an npm registry release is not required. Prefer to inspect the source first? [Run from a clone](docs/getting-started.md#run-from-source).

The graphical setup opens locally in your browser, with a native folder picker, agent checkboxes, a file-change preview, and separate configuration/read/write statuses. Prefer a terminal? Run `agent-memory setup`. No team knowledge or shared workspace service is involved.

The setup walks you through:

1. **Choose a memory folder.** Default: `~/AgentMemory`. An empty subfolder in an Obsidian vault works too.
2. **Choose your agents.** Existing agent configuration folders are detected as suggestions.
3. **Optionally connect existing notes.** Specify a folder agents may consult when curated memory has no answer. Files are referenced, not imported.
4. **Review the changes.** See every file the installer plans to create or update. Existing config files are backed up before changes.
5. **Complete agent-specific steps and test.** Cursor needs its global User Rule checked in the app. File access may require a scoped permission grant.

<img src="docs/assets/setup-ui.jpg" alt="Agent Memory graphical setup with folder selection, eight agent integrations, and a review button" width="100%">

*The local setup screen. Example paths; your existing files are previewed before changes.*

### Keep lookups small

The default policy follows a **bookshelf, not a full library load**:

1. Skip memory for routine tasks.
2. For unfamiliar work, search a few filenames, titles, or error keywords.
3. Start with no more than two searches and two short excerpts.
4. If nothing useful appears, stop searching and use current evidence.

```sh
agent-memory search "java local runner" --json
agent-memory show "topics/local-runner.md" --start 15 --lines 40
```

Search prefers titles, returns at most **8 hits**, and caps serialized output at **4,000 characters**. `show` defaults to 40 lines, allows at most 60, and also caps output at 4,000 characters. Scans have local file/byte limits and report partial results. The notebook, full index, and capture policy are **not preloaded at task startup**. These bounds apply to this CLI, not to every file tool an agent might use. [Retrieval design](docs/retrieval.md).

### Already use Obsidian?

Choose a **new subfolder** inside your vault, such as `My Vault/Agent Memory`. The installer suggests registered vaults when it can find them. All notes are ordinary Markdown, so they remain editable without Obsidian.

### Prefer an explicit command?

```sh
agent-memory setup --agents codex,claude --memory-dir "~/AgentMemory" --dry-run
```

Remove `--dry-run` and add `--yes` to apply noninteractively. Add `--allow-capture` only if you want the installer to allow Claude's built-in file tools to save Markdown inside the memory inbox. It does not grant shell access.

## How it works

```text
Your agent's global instructions
             |
             v
   Small title/keyword search    No notebook preload
             |
             v
      A bounded excerpt         Optional INDEX.md shelf guide
          /    \
         v      v
     topics/  inbox/       Curated procedures + recent discoveries
                  ^
                  |
          New useful lesson
```

The installer adds a clearly marked block to each supported instruction file. The short pointer contains enough retrieval guidance to start. The fuller capture policy stays in the shared folder and is read only when needed. Each agent creates a separate inbox note to reduce conflicts; the index is updated during deliberate cleanup.

```text
AgentMemory/
  MEMORY.md
  INDEX.md
  topics/
  inbox/
  templates/
    lesson.md
```

Lessons include **scope, symptom, cause, fix or preference, evidence, source, and verification date**. User preferences are labeled user-stated; untested advice stays unverified. The notebook begins without any personal or machine-specific facts.

## Verify it works

```sh
agent-memory doctor
agent-memory test
```

`doctor` checks files and shows manual steps. It makes no model calls and does not claim your agents have used memory.

`test --agent opencode` (or another connected agent) records which tool is being checked and creates a temporary fictional note and prints two prompts for a **fresh agent chat**:

- Find a random preflight phrase without being told its answer or file path.
- Save a clearly marked test-only lesson to the shared inbox.

Then run:

```sh
agent-memory test check
agent-memory test clean
```

The check compares the phrase you paste with the hidden expected value and verifies a new matching lesson exists on disk. Cleanup removes only unchanged, identified test files. Repeat with each agent, or ask a different fresh agent to retrieve the note to test sharing. [Full testing guide](docs/testing.md).

### Optional automatic verification

```sh
agent-memory verify --agent opencode --live
```

Fresh CLI runners are available for **OpenCode, Claude Code, and Codex**. Opting in makes up to two agent calls using your existing provider account and can consume credits. Read and write outcomes are stored separately; changed policy/configuration makes old evidence stale. Other integrations use the guided challenge. No runner bypasses permissions or silently switches models. [Testing details](docs/testing.md).

## Commands

| Command | Purpose |
| --- | --- |
| `agent-memory ui` | Local graphical setup, folder picker, connections and tests |
| `agent-memory setup` | Guided terminal installation and preview |
| `agent-memory search "keywords" --json` | Bounded title-first lookup |
| `agent-memory show "topics/note.md"` | Short excerpt with line numbers |
| `agent-memory verify --agent opencode --live` | Explicitly opt into fresh agent calls |
| `agent-memory project add --path "/your/project"` | Connect a personal project; notes stay outside it |
| `agent-memory maintain --reindex` | Preview a refreshed title shelf and review findings |
| `agent-memory doctor` | Configuration health and manual steps |
| `agent-memory instructions cursor` | Print the pointer to paste into Cursor User Rules |
| `agent-memory test` | Prepare a private discovery/capture challenge |
| `agent-memory test check` | Verify the answer and actual saved lesson |
| `agent-memory test clean` | Clean identified, unchanged test notes |
| `agent-memory uninstall` | Remove managed integration; keep your notes |

Run `agent-memory --help` for explicit paths, agent selection, JSON output, and dry runs.

## Privacy and control

- **No account, telemetry, or always-running memory service.** Ordinary commands use local files. The optional graphical setup runs a temporary authenticated loopback server. Only `verify --live` invokes your agent provider; it uses synthetic test notes. Installation fetches code from GitHub through npm.
- **Your chosen AI provider still processes what its agent reads.** Local storage does not make a cloud model offline or private from its provider.
- **Private by default.** The generated memory folder has a Git ignore rule for its contents. Keep personal notes out of public repos and review files before sharing them.
- **No secrets in lessons.** The policy excludes credentials and sensitive logs. This is an instruction, not an automatic secret scanner.
- **Reversible setup.** Marked blocks, local backups, duplicate detection, atomic file writes, and rollback on normal write failures protect existing config. Later edits outside managed blocks are preserved on uninstall.
- **No broad permission bypass.** Read-only sessions stay read-only. Agent sandboxes and existing restrictions still apply.

See [security and data handling](SECURITY.md) for scope and recovery details.

## Compatibility and limits

The CLI uses cross-platform Node APIs. CI runs its filesystem and command tests on **macOS, Windows, and Linux** with Node 22 and 24. Real model behavior must be tested in your installed agent versions.

| Agent | Connection | What to check |
| --- | --- | --- |
| Claude Code | Global `CLAUDE.md` block | File access; optional inbox-only capture permission |
| Codex | Global `AGENTS.md` block; respects `CODEX_HOME` | Overrides and writable access to inbox |
| Cursor | Local user-rule file plus global User Rule instructions | Paste/check the account User Rule in the app |
| Antigravity | Global `GEMINI.md` block | Allow reads for memory and writes for inbox when prompted |
| OpenCode | Global `~/.config/opencode/AGENTS.md` | External-folder access; optional live runner |
| GitHub Copilot CLI | Global `~/.copilot/copilot-instructions.md` | CLI-specific integration; guided tests |
| Windsurf / Cascade | Global `global_rules.md` | 6,000-character limit; check Cascade rules |
| Cline | `~/.cline/rules/agent-memory.md` | Enable the rule and use a guided test |

This release supports default local agent configuration layouts, with `CODEX_HOME`, `COPILOT_HOME`, and `XDG_CONFIG_HOME` respected for the corresponding integrations. Custom profiles and remote runtimes may need manual setup. It does not configure generic web chats, completion-only features, cloud mounts, or syncing. [Detailed compatibility and official references](docs/compatibility.md).

## Maintain your notebook

Ask an agent:

> Review my shared memory inbox. Merge verified reusable lessons into topics, preserve scope and evidence, update INDEX, and flag stale or conflicting advice.

Maintenance stays under your control:

```sh
agent-memory maintain --archive-duplicates --reindex
# Review the findings and action list, then use the returned ID:
agent-memory maintain --apply --plan PLAN_ID
```

Only exact duplicates can be archived automatically. Same-title notes are flagged as possible conflicts, not rewritten. Old verified procedures are flagged after 180 days. Apply requires the reviewed plan ID and rejects changed files; notes are archived, not deleted. No cleanup is scheduled automatically. Keep topics small, review old procedures, and scope machine-specific fixes carefully.

### Connect a personal project

```sh
agent-memory project add --path "/path/to/project" --dry-run
agent-memory project add --path "/path/to/project"
```

This adds a small `AGENTS.md` pointer to your personal notebook. It does not copy knowledge into the repo or create a team knowledge feature. New pointer files in ordinary Git checkouts receive a local `.git/info/exclude` entry. Already-tracked instruction files and worktrees require review before committing. Use `project remove --path ...` to disconnect. [Project details](docs/getting-started.md#personal-project-connections).

### Update an existing 0.1 installation

```sh
npm install --global git+https://github.com/Ameer-Jamal/agent-memory.git
agent-memory setup --upgrade-policy
```

Setup refreshes its managed pointers. `--upgrade-policy` explicitly replaces `MEMORY.md` with the efficient policy and saves a backup; topics and lessons are kept. Review custom policy text before opting in. Existing notebooks are otherwise preserved.

## Development

```sh
git clone https://github.com/Ameer-Jamal/agent-memory.git
cd agent-memory
npm ci
npm run verify
```

Tests run against isolated temporary homes, never your real agent configs. See [CONTRIBUTING.md](CONTRIBUTING.md) for the adapter and safety conventions.

## Support

[Report a bug](https://github.com/Ameer-Jamal/agent-memory/issues/new?template=bug_report.yml) · [Suggest an improvement](https://github.com/Ameer-Jamal/agent-memory/issues/new?template=feature_request.yml)

[MIT](LICENSE) © Ameer Jamal. Independent community project; not affiliated with the agent vendors.
