# Graphical setup

```sh
agent-memory ui
```

A temporary setup app opens in your default browser. It runs only on this computer. No cloud account, Obsidian plugin, or background memory service is required. Prefer the terminal? `agent-memory setup` remains available.

## What you can do

- Choose a plain folder or a new Obsidian subfolder with a native folder picker, or paste a path.
- Select from eight coding-agent integrations.
- Review every planned file before applying setup, including an explicit policy-upgrade option.
- See configured, read-verified, and write-verified states separately, with stale evidence identified.
- Copy the short pointer for a tool's manual User Rules step.
- Connect/disconnect a personal project without moving your knowledge into it.
- Search a few matching pages and open bounded excerpts.
- Preview duplicates, stale notes, same-title review candidates, and a generated title shelf; explicitly apply reviewed archive/index actions.
- Prepare and check a guided challenge, or opt into supported automatic CLI tests.

The folder picker uses the platform's normal folder dialog on macOS and Windows. On Linux it uses `zenity` when installed; pasting a path always works. A folder picker chooses an existing directory; you can type a new child-folder name in the path field for the installer to create.

## Local access and lifetime

The server binds to 127.0.0.1 on a random port. The printed private URL contains a per-run token. Keep it private; it authorizes local setup APIs for that session. Unexpected Host/Origin headers are rejected, APIs require authorization, and responses are not cached. The app closes after 15 idle minutes. Ctrl+C stops it immediately.

```sh
agent-memory ui --no-open
agent-memory ui --port 54321
```

Do not publish or tunnel the local URL. The browser app is for setup and inspection, not a network-accessible knowledge service. Ordinary search, preview, and maintenance make no model calls. Automatic verification requires an explicit opt-in and uses the selected agent's provider account.
