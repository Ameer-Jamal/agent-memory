# Security and data handling

Agent Memory is a local configuration tool. It creates Markdown notes and adds instructions to selected coding-agent configs. It does not run a server, make model requests, read agent authentication tokens, or upload knowledge. npm/Git fetch the software during installation; your coding agents make their own normal provider requests.

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

For ordinary bugs without sensitive information, use the bug report issue template. Version 0.1.x is the initial supported line.
