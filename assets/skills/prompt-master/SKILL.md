---
name: prompt-master
description: Use when designing, auditing, compressing, or testing prompts, prompt templates, system instructions, skill prompts, or trigger/anti-trigger examples.
---

# Prompt Master

Use this skill to improve prompts as reusable operating contracts. The goal is not prettier wording; the goal is lower ambiguity, tighter trigger boundaries, and outputs that can be evaluated.

## Core Rule

Treat prompts as executable specifications for an agent.

Before writing or changing a prompt, identify:

- **Job**: what the prompt must cause the model to do.
- **Boundary**: what the prompt must not take over.
- **Inputs**: fields, files, tools, context, and assumptions required.
- **Output**: exact structure, artifact type, or decision format expected.
- **Verification**: trigger cases, anti-trigger cases, and failure signals.

If one of these is missing, fix that before polishing language.

## When To Use

Use this skill for:

- Designing a new prompt, prompt template, or prompt pack.
- Turning a workflow idea into skill-ready instructions.
- Auditing an existing prompt for overreach, conflict, ambiguity, or unverifiable claims.
- Compressing a long prompt while preserving behavior.
- Creating trigger and anti-trigger examples for a skill or agent behavior.
- Defining output contracts for model-generated artifacts.

## Anti-Triggers

Do not use this skill for:

- Executing the underlying domain task directly, such as planning a trip, fixing code, or writing a PR review.
- Ordinary copyediting, translation, or marketing copy unless the user asks for prompt behavior.
- Simple one-off questions where no reusable prompt or agent instruction is being designed.
- Project governance decisions about whether a capability should be adopted, enabled, blocked, or synced.
- Replacing project-specific `AGENTS.md` rules, repository workflow docs, or a dedicated domain skill.

## Prompt Design Workflow

1. State the real task and the expected user-facing outcome.
2. Separate durable instructions from project-specific policy.
3. Write trigger rules in terms of user intent, not keyword decoration.
4. Write anti-triggers for adjacent tasks the prompt must not capture.
5. Specify required evidence for volatile, factual, legal, financial, medical, or external-state claims.
6. Specify the output shape and what to omit.
7. Add at least one trigger case and one anti-trigger case.

Keep the final prompt lean. Remove process narration that does not change model behavior.

## Audit Checklist

Reject or revise a prompt when:

- It can trigger on almost any task.
- It says "always" without a real safety reason.
- It mixes governance, planning, execution, and verification into one broad instruction.
- It hides project-specific paths, credentials, commands, or business rules in a global prompt.
- It asks for current facts without requiring verification.
- It has no anti-trigger examples.
- Its output cannot be checked by a person or a test.

## Output Format

For prompt design or rewrite tasks, return:

- **Conclusion**: whether the current direction is usable.
- **Key Problem**: the highest-risk ambiguity or overreach.
- **Rewritten Prompt**: the usable prompt or skill text.
- **Trigger Tests**: realistic examples that should trigger it.
- **Anti-Trigger Tests**: realistic examples that should not trigger it.
- **Failure Signals**: how to know the prompt is behaving badly.

For small prompt edits, keep the response shorter but still include the key boundary decision.
