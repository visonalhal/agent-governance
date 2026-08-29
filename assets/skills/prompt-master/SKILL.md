---
name: prompt-master
description: Use when designing, auditing, compressing, or testing prompts, prompt templates, system instructions, skill prompts, or trigger/anti-trigger examples.
---

# Prompt Master

Treat prompts as executable contracts: optimize for clear behavior, narrow activation, and observable results.

Identify:

- **Job**: what the prompt must cause the model to do.
- **Boundary**: what the prompt must not take over.
- **Inputs**: required context, tools, and assumptions.
- **Output**: expected artifact or decision shape.
- **Verification**: trigger cases, anti-triggers, and failure signals.

Resolve missing parts before polishing language.

Do not use it to:

- Execute the underlying domain task.
- Do ordinary copyediting or translation.
- Handle one-off questions with no reusable instruction.
- Project governance decisions about whether a capability should be adopted, enabled, blocked, or synced.
- Replace project `AGENTS.md`, workflow docs, or a domain skill.

## Workflow

1. State the task and user-facing outcome.
2. Separate durable behavior from project policy.
3. Write triggers from user intent, not keywords alone.
4. Add anti-triggers for adjacent tasks.
5. Require evidence for volatile or external-state claims.
6. Specify output and omissions.
7. Add at least one trigger case and one anti-trigger case.

Reject or revise a prompt when:

- It can trigger on almost any task.
- It uses absolute rules without a real safety or correctness reason.
- It combines unrelated governance, planning, execution, and verification.
- It hides project paths, credentials, commands, or business rules globally.
- It requires current facts without verification.
- It has no anti-trigger examples.
- Its output cannot be checked by a person or a test.

Return the rewrite plus only the assumptions and tests needed to evaluate it. Keep small edits small.
