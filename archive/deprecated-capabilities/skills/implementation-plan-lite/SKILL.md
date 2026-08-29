---
name: implementation-plan-lite
description: Use when a change spans multiple modules, migrations, runtime config, or shared contracts and implementation needs a concrete sequence before edits.
---

# Implementation Plan Lite

Write the smallest plan that prevents avoidable implementation mistakes.

## Include

- Goal and success criteria.
- Files or subsystems likely to change.
- Ordered implementation steps.
- Verification commands.
- Explicit assumptions.

## Anti-Triggers

- Do not plan for one-line edits, simple commands, or obvious local fixes.
- Do not require user approval when the user already asked to implement and the scope is clear.
- Do not create plan files unless the user asks for a saved plan or the work is governance-critical.
- Do not add subagents by default.
