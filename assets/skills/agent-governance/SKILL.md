---
name: agent-governance
description: Use when adopting, globalizing, updating, deprecating, auditing, or comparing agent skills, workflow rules, AGENTS.md contracts, trigger policies, project overrides, runtime profiles, or plugin capabilities. Use when the user mentions agent governance, agent-governance, agent-governnance, skill governance, global skills, project opt-in, trigger rules, or preventing workflow drift.
---

# Agent Governance

Use this skill to decide how agent capabilities should be adopted and controlled. Governance is a meta-layer: it manages skill lifecycle, trigger boundaries, project overrides, and version drift. It should not become a total workflow controller.

## Layer Boundary

Separate these layers explicitly:

- **Capability skill**: a focused workflow such as long-task planning, code review, debugging, or document creation.
- **Governance skill**: rules for adopting, updating, disabling, pinning, and auditing capabilities.
- **Project instructions**: local `AGENTS.md` or equivalent files that opt in, narrow, override paths, and define project-specific gates.

Do not put a capability's full execution workflow inside governance. Do not duplicate the same contract in both global and project instructions. Global skills provide reusable method; projects provide local policy.

## Adoption Checklist

Before creating or changing a global skill, check:

- Source of truth: where the canonical skill lives. Prefer the user's global skill source, such as `~/.agents/skills`, unless the project or runtime profile says otherwise.
- Runtime effect: prompt-only, local scripts, network access, credentials, filesystem writes, hooks, auto-update, or external tools.
- Trigger quality: clear triggers, clear anti-triggers, and no mandatory overreach.
- Overlap: which existing skill or project rule it replaces, narrows, or references.
- Project fit: which projects may opt in, which should only reference it, and which must disable it.
- Evidence: what file, command, scenario, or review proves the governance change works.

Reject or narrow skills that are broad process frameworks without safe trigger rules.

## Global Skill Rules

Approve a global skill only when it is:

- Reusable across projects without project-specific paths or business terms.
- Narrow enough to avoid dragging simple tasks into heavyweight workflows.
- Explicit about anti-triggers.
- Prompt-only unless scripts or external tools are truly part of the capability.
- Versionable and inspectable as plain files.
- Compatible with project-level opt-in and override.

If a skill needs project-specific paths, runtime commands, credentials, schema names, product concepts, or rollout gates, keep those in the project instructions.

## Project Override Rules

Project instructions may:

- Opt in to a global skill.
- Narrow trigger rules.
- Set plan, artifact, or template paths.
- Require project-specific validation, rollback, or evidence.
- Disable a global skill for that project.

Project instructions should not:

- Copy a full global workflow contract unless the project intentionally forks it.
- Broaden a global skill so much that it triggers on ordinary small tasks.
- Hide project-specific requirements inside a global skill.
- Preserve obsolete local rules after adopting a global capability.

When global and project rules conflict, follow the higher-priority runtime instruction, then the project instruction, then the global skill. Record the conflict if it affects future work.

## Change Protocol

For governance-critical changes:

1. Identify the capability and the project impact.
2. Decide whether the change belongs in a global skill, project instructions, or both.
3. Make the smallest durable edit that removes duplication or ambiguity.
4. Record the decision and consequence in the relevant plan, changelog, or project doc.
5. Verify at least one trigger case and one anti-trigger case.

Use a saved long-task plan when the governance change spans multiple capabilities, projects, or rollout gates.

## Failure Signals

Treat these as real problems, not polish issues:

- A governance skill starts executing every workflow itself.
- A project path, business domain, or local command leaks into a global skill.
- Global and project instructions define the same contract differently.
- A broad skill has no anti-triggers.
- A simple request is forced through a multi-step governance workflow.
- Adoption is claimed without a trigger case, an anti-trigger case, and an inspectable changed file.
