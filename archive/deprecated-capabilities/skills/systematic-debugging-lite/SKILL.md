---
name: systematic-debugging-lite
description: Use when there is a real bug, failing test, flaky behavior, CI failure, runtime exception, incorrect output, or user explicitly asks for root-cause investigation.
---

# Systematic Debugging Lite

Find evidence before patching.

## Flow

1. Reproduce or identify the exact failing signal.
2. Read the error, stack, assertion, or observed wrong output completely.
3. Trace the narrow data/control path from input to failure.
4. Compare with a working nearby pattern.
5. Make one root-cause fix and verify it.

## Anti-Triggers

- Do not use for process criticism, plugin governance questions, or simple commands.
- Do not inspect DB/logs/services without a failure signal that points there.
- Do not stack speculative fixes.
- Do not call something fixed without running the relevant verification.
