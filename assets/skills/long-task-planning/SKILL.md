---
name: long-task-planning
description: Use when work needs a durable multi-session plan: cross-module/service/package/data-contract changes, migrations, runtime flags, workers, external APIs, production behavior, rollback, evals, generated samples, manual quality review, rollout gates, or when the user mentions milestone, goal, phases, long task, saved plan, plan docs, acceptance criteria, validation, or evidence. Do not use for simple commands, narrow single-file edits, clear config questions, code explanations, or short local fixes.
---

# Long Task Planning

Use this skill to keep long-running agent work traceable across sessions. The point is not more ceremony; the point is preventing lost context, fake completion, and giant goals that cannot be verified.

## First Decision

Classify the task before writing files.

Use long-task planning when any of these are true:

- The work spans multiple modules, services, packages, data contracts, or repositories.
- The work touches migrations, runtime flags, background workers, external APIs, production behavior, rollback, or deployment gates.
- The work needs samples, evals, generated artifacts, human review, rollout observation, or a release gate.
- The user explicitly asks for milestones, a goal, phases, a long task, saved plan docs, acceptance criteria, validation, or evidence.
- The work is likely to exceed one short implementation pass or lose important context through conversation compaction.

Do not use long-task planning for:

- A simple command, status check, or direct file lookup.
- A narrow single-file edit with obvious verification.
- A configuration or governance question that only needs an answer.
- Debugging without a real failure, log error, or reproducible symptom.
- A small implementation where a concise inline plan is enough.

If the task does not meet the trigger, say so briefly when useful and proceed with the smaller workflow.

## Project Overrides

Before creating plan docs, inspect project instructions such as `AGENTS.md`, `README.md`, or existing `docs/plans` conventions.

Project instructions may define:

- Plan document root.
- Template path.
- Default language.
- Required milestone names.
- Project-specific gates, rollback rules, or evidence requirements.
- Whether the project opts in, disables, or narrows long-task planning.

Do not invent a global project path when the project has no convention. If the user explicitly asks to save a plan and no local convention exists, either use an existing project docs area after inspection or ask for the preferred location.

## Plan Contract

A durable long-task plan should contain, at minimum:

- `README.md`: objective, non-goals, milestone order, cross-milestone invariants, completion gate.
- One file per milestone: objective, non-goals, scope, acceptance criteria, validation, failure signals, result.
- `decisions.md`: dated decisions, reasoning, and consequences.
- `evidence.md`: baseline facts, implementation evidence, validation evidence, and remaining risks.

Keep the plan specific enough to execute, but not so detailed that it becomes stale after one edit.

## Milestone Protocol

Treat one milestone as the default unit of active execution.

- A goal should point to one active milestone unless the user explicitly asks for broader exploration.
- Before implementing, ensure the milestone has acceptance criteria and validation steps.
- Before marking a milestone done, update its `Result` and add evidence to `evidence.md`.
- If the user asks to continue across milestones, finish and record evidence for each milestone before entering the next one.

## Completion Levels

Do not collapse completion states.

- **Implementation Done**: code, config, or docs are changed and the narrow required verification passes.
- **MVP Validated**: representative samples, evals, runtime checks, or human review prove the approach works for the intended use case.
- **Release Ready**: rollout, rollback, production observation, docs sync, and accepted residual risks are complete.

Use the lowest level that the evidence actually proves. A passing narrow check does not prove a broad release gate.

## Evidence Rules

Evidence must be inspectable after the conversation is gone.

Record:

- Files created or changed.
- Commands run and pass/fail status.
- Sample IDs, report paths, screenshots, generated artifacts, or manual review notes when relevant.
- Known skipped validation and the risk it leaves.
- Open decisions or accepted residual risk.

Do not claim completion from intent, code inspection alone, or broad statements like "looks good" when a runnable or reviewable check exists.

## Failure Signals

Stop and narrow the plan when any of these appear:

- A simple task is being turned into a saved plan.
- The plan mixes planning, implementation, eval, review, and rollout into one unbounded goal.
- A narrow test is being used to prove a broad milestone.
- Project-specific paths or business terms are leaking into a reusable global workflow.
- The evidence file records conclusions but not commands, samples, artifacts, or review basis.
- Completion language claims MVP Validated or Release Ready without matching evidence.
