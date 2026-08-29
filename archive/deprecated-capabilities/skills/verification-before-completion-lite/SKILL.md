---
name: verification-before-completion-lite
description: Use before claiming an implementation, fix, migration, or governance sync is complete and when the user expects evidence of what was verified.
---

# Verification Before Completion Lite

Report evidence, not vibes.

## Do

- Run the narrowest command that proves the changed behavior.
- Include typecheck/test/build/audit commands when the changed surface requires them.
- If a command cannot run, say why and what risk remains.
- Report the actual command names and pass/fail status.

## Anti-Triggers

- Do not run full suites for trivial docs-only edits unless requested.
- Do not claim success from code inspection alone when a runnable check exists.
- Do not hide skipped verification.
