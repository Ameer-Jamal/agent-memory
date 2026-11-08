# Changelog

## Unreleased

- Guided setup reuses the installed memory and optional notes folders as prompt defaults, so adding agents does not accidentally request a relocation. First-install defaults, explicit options and existing installer state remain compatible.

- Search ranking: deterministic BM25-style term weighting with title/path, tag and heading boosts and a mild (up to 10%) recency boost from file modification time. All terms must still match; the 8-hit and 4,000-character caps are unchanged. A cheap 2 KiB pass covers every note; only likely matches are deep-read (64 KiB, shared 8 MiB budget). Cheap-pass matches survive exhaustion of the deeper-read budget. Ties sort by code point, independent of locale.
- Capture guardrails: `memory_remember` refuses more credential shapes (private keys, AWS access keys, common API/JWT/bearer tokens, URLs with passwords, secret-named assignments) without echoing the value, and previews same-scope word-overlap matches. Overlap is advisory; only exact generated duplicates are automatically reused. Overlap hints include `same_status` and `same_source`. Numeric hints preserve version punctuation and order, and changed facts/metadata remain savable.
- `agent-memory maintain --promote inbox/NOTE.md` previews moving a vetted inbox note to `topics/`, using the existing reviewed-plan apply flow. Refuses traversal, links, credential-like content, name collisions, names search skips (such as `secrets.md`, including mixed path separators on Windows), and notes changed after preview. Not exposed through MCP. Apply verifies plan integrity and canonical containment; combined promotion/reindex uses the destination path. Maintenance summary paths use forward slashes on every platform.

## 0.3.0 — 2026-10-29

- Optional local stdio MCP server with bounded search/read, metadata refresh, and previewed inbox capture. Uses the official SDK and Zod; runtime dependencies are no longer zero.
- Read-only default; explicit inbox-write opt-in, expiring duplicate reviews, stale/concurrent-change checks, and exclusive new-note writes.
- Connection-snippet command and modern/legacy real-client protocol tests.
- Near-duplicate capture policy: reuse matching-scope lessons with over 90% semantic overlap and no useful new information; preserve material differences. Similarity remains agent judgment.

## 0.2.0 — 2026-10-18

- Search-first policy: no whole-notebook startup loads, two initial searches/notes, and stop when no useful lead appears.
- Bounded title/content search and line-numbered excerpts, each capped at 4,000 output characters.
- Native instruction adapters for OpenCode, GitHub Copilot CLI, Windsurf/Cascade, and Cline.
- Optional local graphical setup with a folder picker, previews, connection statuses, search, maintenance, and tests.
- Optional fresh CLI verification for OpenCode, Claude Code, and Codex; attributed read/write evidence with stale-result detection.
- Personal project connections through AGENTS.md, with local Git excludes for new pointer files in standard checkouts.
- Previewed maintenance: exact-duplicate archives, stale-procedure review, possible-conflict flags, and a bounded generated shelf.
- Explicit backed-up policy upgrade for existing installations. No team knowledge feature.

## 0.1.0 — 2026-10-18

First public release.

- Guided setup for Claude Code, Codex, Cursor, and Antigravity using a shared Markdown folder.
- Optional Obsidian vault discovery and existing-notes reference; no Obsidian dependency.
- Change previews, local backups, repeatable setup, rollback on normal write failures, and uninstall that retains knowledge and later unrelated edits.
- Optional scoped Claude inbox capture permission; explicit manual steps for other agent permission/UI behavior.
- Configuration diagnostics and a manual random-phrase read/write challenge with conservative cleanup.
- Cross-platform installer tests, documentation, and contribution guides.

Agent behavior is not guaranteed by installation. Remote sync, model training, automatic model invocation, and a graphical installer are outside this release.
