# Compatibility

Agent Memory connects tools through their existing Markdown instruction mechanisms. It does not intercept their requests. An optional local stdio MCP server offers explicit memory tools; file-only connections still work. See [MCP setup](mcp.md) for client boundaries.

## Local connections

| Agent | Instruction file | Additional step |
| --- | --- | --- |
| Codex | `$CODEX_HOME/AGENTS.md`, default `~/.codex/AGENTS.md` | Check overrides and inbox sandbox access |
| Claude Code | `~/.claude/CLAUDE.md` | Optional inbox-only file permission, or approve writes manually |
| Cursor | `~/.cursor/rules/agent-memory.mdc` | Paste the pointer into account User Rules and test the actual app |
| Antigravity | `~/.gemini/GEMINI.md` | Grant scoped folder read and inbox write permissions |
| OpenCode | `~/.config/opencode/AGENTS.md` (respects XDG_CONFIG_HOME) | Scoped external-folder access; optional live runner |
| GitHub Copilot CLI | `~/.copilot/copilot-instructions.md` (respects COPILOT_HOME) | CLI connection; guided tests |
| Windsurf / Cascade | `~/.codeium/windsurf/memories/global_rules.md` | Legacy Cascade rule mechanism; 6,000-character limit |
| Cline | `~/.cline/rules/agent-memory.md` | Check the rule is enabled; guided tests |

`~` means your OS user's home folder, including on Windows. The CLI uses the platform's path APIs. Default configuration layouts are supported; custom Claude config roots, separate profiles, managed enterprise policy, WSL boundaries, and containers may need manual instructions. The installer refuses symlink/junction paths rather than silently editing their targets.

Cursor's global account User Rule is managed in its UI, so the CLI prints the pointer instead of editing its internal settings database. The local rule file is a second connection path, not proof the account rule is active. Uninstall can remove the file but cannot remove the account rule for you.

Antigravity's file grants are configured through its normal permissions UI. The installer does not change broad permission presets. Grant access to the chosen memory folder and its inbox, not your whole filesystem.

## Tested versus configured

- Automated CI tests cover installer behavior using temporary directories on macOS, Linux, and Windows with Node 22 and 24. They do not invoke paid models or use your account. Optional `verify --live` calls are a separate user action.
- The original local prototype was behavior-tested on macOS: all four agents found a random phrase and wrote test-only lessons; fresh agents retrieved other tools' lessons. That validates the approach on that machine, not every app version or this install on yours.
- This repository includes a guided read/write challenge so users can verify their installed versions. `doctor` never labels an agent behavior-verified based only on a file.

Model names, CLI versus desktop authentication, workspace trust, permissions, and app versions can affect the result independently of memory. See [troubleshooting](troubleshooting.md).

## Boundaries

- A read-only agent can consult memory but cannot capture lessons.
- Local paths are not automatically accessible to cloud jobs or other computers. Mount/copy/sync the folder through your chosen method, then configure that runtime's instructions and permissions.
- The generated Git ignore rule helps keep memory out of accidental commits. It is not encryption or a substitute for reviewing what an agent can read.
- This configures coding-agent chats. Generic web chats, autocomplete, inline edits, and unrelated products may not use these instruction files.
- Copilot CLI support does not establish global support for Copilot in every IDE. Windsurf/Cascade support does not establish support for other Devin agents. OpenCode supports a Claude fallback, but this installer uses its own global file explicitly.
- The model is not retrained. An agent can ignore or misunderstand instructions; use explicit tests and inspect valuable captures.

## Official references

These are the mechanisms used by the adapters. Review the vendor documentation when behavior changes:

- [Codex: AGENTS.md instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code: project and user memory](https://code.claude.com/docs/en/memory)
- [Claude Code: file permissions](https://code.claude.com/docs/en/permissions)
- [Cursor: rules and User Rules](https://cursor.com/help/customization/rules)
- [Antigravity: rules](https://antigravity.google/docs/rules/)
- [Antigravity: scoped permissions](https://antigravity.google/docs/permissions/)

- [OpenCode: rules](https://docs.opencode.ai/docs/rules/)
- [Copilot CLI: custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)
- [Windsurf/Cascade: global rules](https://docs.windsurf.com/windsurf/cascade/memories)
- [Cline: rules](https://docs.cline.bot/customization/cline-rules)

Integration references checked October 18, 2026. This independent project is not affiliated with the vendors.
