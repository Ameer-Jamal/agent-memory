# Repository instructions

- Keep this a local Markdown configuration tool with no runtime dependencies unless a concrete feature justifies one.
- Preserve user configs, later edits, and knowledge. Never fix an integration by disabling an agent sandbox or granting broad command access.
- Changes to setup, ownership, permissions, or cleanup require meaningful isolated tests. Use `context({home, configDir})` with temporary homes; never touch real agent configs in tests.
- Distinguish file/config checks from actual model behavior. Document manual integration steps and unsupported surfaces honestly.
- Keep private notes, credentials, config backups, and real machine paths out of this public repository.
- Run `npm run verify` before publishing changes. Update relevant guides when CLI behavior changes.
