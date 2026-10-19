# Verify memory with your actual agents

A config file existing is not proof that an agent consults it. Test discovery, capture, and sharing separately.

## 1. Check installation

```sh
agent-memory doctor
```

Resolve failed checks and complete relevant manual steps. `PASS` here means the file/config check passed. It does not mean a model was run. Start a fresh agent chat after setup.

## 2. Prepare a challenge

```sh
agent-memory test --agent opencode
```

The CLI creates one fictional note in `inbox/`, stores private test state, and prints two prompts. The first prompt has a random task name. The expected phrase and its file path are intentionally absent from the prompt.

Paste the read prompt into your agent. It should use its global pointer, find the fictional note, return the exact phrase, and cite its file. Do not tell it the memory path or the answer as a fallback; that would test a different behavior.

## 3. Test capture

Paste the generated capture prompt into the same agent. It asks the agent to remember a test-only user correction using a different random label.

The agent should create a new Markdown file in the shared inbox. It must contain that label and be marked test-only and user-stated. A reply saying “saved” does not pass by itself.

## 4. Verify and clean

```sh
agent-memory test check
```

Paste **only the exact preflight phrase** returned in step 2, without backticks or surrounding explanation. The command checks the answer against the private expected value and looks for a new matching capture file. Both read and write must pass.

```sh
agent-memory test clean
```

Cleanup removes the original fixture only if unchanged. Capture receipts are removed only if `test check` identified them and their content has not changed since. Edited or unverified files are kept. Complete cleanup before preparing another challenge or uninstalling.

Repeat in each agent with a fresh challenge. One pass is not evidence about every agent.

## Test sharing

During an active challenge, ask a different fresh agent to retrieve the fictional captured task's exact label and cite the source. Supply the task name from the capture prompt, but omit the label and path. Compare its answer to the label in the original prompt. This is a manual cross-agent check; the CLI does not attribute which tool wrote or read a file.

## Script-friendly form

```sh
agent-memory test prepare --json
agent-memory test check --answer "EXACT_PHRASE_FROM_YOUR_AGENT" --json
agent-memory test clean --yes --json
```

These guided commands never launch models or spend model credits. Optional live verification is separate. Your agent may make its normal provider requests while answering the prompts.

## Automated repository tests

```sh
npm ci
npm run verify
```

Tests cover config preservation, repeated installation, reconnecting a preserved memory folder, optional permission ownership, rollback, symlinks, malformed config, edited blocks, concurrent-operation locks, stale test fixtures, and CLI behavior. All installer tests use temporary homes; they do not write to your real coding-agent configs.

## Optional automatic fresh CLI checks

```sh
agent-memory verify --agent opencode --live
agent-memory verify --agent claude --live
agent-memory verify --agent codex --live
```

These commands explicitly invoke your chosen CLI and may use provider credits. They run a fresh read-only discovery call, then (only after read succeeds) a scoped capture call. Final answer text is graded, not tool output. The capture is checked on disk. Exact unchanged fixtures are cleaned afterwards; unexpected/edited files are retained.

No model is silently changed, no credentials are copied, and no approval/sandbox bypass flags are used. A provider error, expired key, unsupported model, permission denial, timeout, or unavailable executable fails the relevant check. Other integrations use the guided challenge; config support does not imply an automatic runner.

Use `doctor` or the GUI to see configured/read/write states separately. Results record evidence type and date; changing the global pointer or policy marks old results stale. For manual challenges, pass `--agent NAME` when preparing so results are attributed to that tool. Manual results depend on the answer the user supplies and are identified as manual evidence.

Each CLI stage has a two-minute timeout and a 128 KiB output limit. Those caps bound the test process/output, not a precise model-token or provider-spend budget. Live verification uses synthetic notes, but your selected CLI may load its normal personal customization before the task.
