# Explicit memory tools through MCP

MCP gives an agent named actions for memory. It does not make memory automatic: the agent must invoke a tool, and the host must allow it. The installed short pointer tells agents to use the tools when available. File/CLI access remains supported.

## Connect locally

Run normal setup once, then print a connection block:

```sh
agent-memory setup
agent-memory mcp-config --allow-write
```

Merge the output into your local client's MCP server settings. Do not replace unrelated servers. The block contains a local absolute Node path, CLI path, and installer-state path; regenerate it after moving the installation or changing Node. Do not commit the printed personal config to the public repository.

Typical shape (example paths):

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/agent-memory/bin/agent-memory.mjs", "mcp", "--allow-write"]
    }
  }
}
```

Use the command/args/env inside the block for clients that use a different wrapper. For example, Codex uses a TOML `mcp_servers` entry; OpenCode uses an `mcp` entry with `type: "local"` and a command array. Check your client's current local-MCP UI/docs. This command does not edit any client configs or grant broad filesystem/shell permissions.

Remove `--allow-write` for read-only use. Restart/reconnect the MCP server after changing that setting. The server never executes shell commands on behalf of MCP callers, rewrites configs, edits existing notes, or deletes lessons.

This is **local stdio**, not a connector URL. A cloud-only client accepting HTTPS connector URLs cannot launch it directly. No public endpoint, tunnel, sync service, or browser-chat integration is supplied. Installed instruction adapters and MCP host compatibility are separate; not every agent surface supports local MCP.

## Tools

- `memory_search`: few keywords, optional source `notes`, at most eight hits and 4,000 result characters.
- `memory_read`: relative note path and optional start/lines (40 default, 60 max). Read another range only for a relevant lead. Each excerpt is capped at 4,000 result characters.
- `memory_refresh`: reload health, notebook counts and a revision from disk. Returns no note bodies or full index. No content cache needs clearing: search/read already use current disk data. Does not reindex, rewrite policy, train a model, scan chat history, or refresh another agent's loaded instructions.
- `memory_remember`: with capture enabled, preview a concise scoped lesson; inspect likely matches; finalize using the returned review ID and a save/reuse/difference decision. Never infer success from the tool's presence: require a `saved` or `reused` result.

A lesson includes title, scope, status (`verified`, `user-stated`, or `unverified`), symptom, cause, fix, evidence and source. Input is capped at 180 words to leave room for the generated note's headings/metadata within 200 words. Verified means the caller supplies supporting evidence; MCP does not independently execute the fix.

## Saving without clutter

1. Call `memory_remember` with `lesson` only. No note is saved yet. A compact preview supplies candidate paths and a `review_id`.
2. Read likely matches with `memory_read`; refine search if the title search misses synonyms. Candidate retrieval is lexical and bounded, not a complete semantic search.
3. Call `memory_remember` with `review_id` and one decision:
   - `reuse_existing` + `existing_path`: over 90% meaning overlap, same scope, nothing useful added. No new file.
   - `save_difference` + `existing_path`: the same scope gains useful evidence or a changed fact. A new short note links to the original; the original stays intact.
   - `save_new`: a useful new scoped lesson.

An exact generated duplicate among the bounded preview candidates is reused even if the caller requests a new save. This is not a full-catalog guarantee. The percentage is **agent judgment**, not a computed meaning score or an enforced semantic classifier. A distinct environment/version or conflicting evidence must not be discarded just because wording matches. Reuse/difference requires a matching scope field; a different scope uses `save_new`.

Reviews are private in-process state, limited to 20 pending previews, and expire after 15 minutes. They do not survive restarting the MCP process. Changed notebook metadata, policy, or configured root requires a fresh preview so another agent's intervening capture is considered. The MCP process writes only new unique inbox files; it provides no archive/delete/merge tool.

## Verify the full loop

Ask a connected agent to refresh status and find an existing known note. Have it read two bounded ranges. Then ask it to remember one explicitly fictional, test-only preference. Verify the returned relative path exists under inbox, and that a second attempt chooses reuse rather than writing another file. Review/remove synthetic fixtures deliberately; these MCP notes are not the CLI `test` command's owned fixtures.

The repository's isolated tests drive real stdio clients through discovery, lookup, pagination, refresh, preview/save and reuse. They cover modern automatic negotiation and the legacy handshake, read-only mode, schema rejection, stale reviews, concurrency, scope mismatch, word limits, credential-pattern rejection and linked/traversal paths. They do not prove your model will choose to invoke a tool. No paid model calls are needed for these tests.

Protocol implementation uses the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). The server uses `serveStdio`, which supports modern and legacy clients through one factory; see [official stdio documentation](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html).
