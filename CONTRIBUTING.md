# Contributing

Thanks for helping make shared memory easier to use. Small improvements to onboarding, compatibility, and failure messages are especially useful.

## Local development

Requirements: Node.js 22+ and Git. No third-party runtime packages or build step.

```sh
npm ci
npm run verify
```

`verify` checks JavaScript syntax, runs the test suite, and previews the npm package contents. CI runs on macOS, Linux, and Windows with Node 22 and 24. Tests must use temporary homes and installer state; never run setup against a contributor's real config as part of the test suite.

## Project structure

```text
bin/agent-memory.mjs    CLI, guided questions, preview and confirmations
src/core.mjs           Planning, installation, backup, rollback and checks
src/templates.mjs      Small global pointer and shared Markdown policy
src/adapters.mjs       Agent instruction targets and runner availability
src/notebook.mjs       Bounded search/excerpts and reviewed maintenance
src/projects.mjs       Personal project pointers and local excludes
src/verification.mjs   Opt-in bounded fresh CLI checks
src/ui.mjs + web/      Temporary authenticated loopback setup app
test/                  Isolated filesystem and command tests
docs/                  Guides and SVG illustrations
```

The core API accepts `context({home, configDir})` so tests can isolate every affected path. Preview data must contain paths and actions, not original config contents. Keep state and backups outside the source repository.

## Adding or changing an integration

1. Link the vendor's official instruction-loading documentation.
2. Define the narrowest supported entry point; preserve existing instructions and unrelated settings.
3. Make setup repeatable and uninstall ownership explicit. Do not restore whole old configs over later user edits.
4. Add tests for fresh setup, existing config, repeated setup, malformed input, and cleanup after later edits.
5. Explain manual steps, app/CLI differences, permissions, and unverified combinations. A file check cannot establish model compliance.
6. Test real behavior manually where possible and state the platform and agent version. Do not put credentials or personal memory in a fixture.

Do not disable a sandbox, broaden shell permissions, invoke paid model calls in CI, add telemetry, or import private user notes to make an integration easier. New dependencies should have a concrete benefit that the standard library cannot reasonably provide.

## Pull requests

Describe the user-visible problem, resulting behavior, and relevant tests. Include before/after output for CLI changes and a screenshot or render for visual changes. Keep unrelated cleanup separate. Use synthetic paths and notes in examples.

For bugs, start with the issue template and redact private material. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

Retrieval changes must keep the 4,000-character serialized search/show caps and explicit partial-scan reporting. Avoid unconditional notebook/index loads in global instructions. UI actions require authorization/origin checks and previews; tests must not launch native dialogs or real models.
