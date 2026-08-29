---
name: agent-governance
description: Use when the user explicitly invokes governance to adopt, scope, audit, update, or retire Codex skills, plugins, profiles, or AGENTS.md contracts. Do not use for ordinary project work.
---

# Agent Governance

Decide where a capability belongs and produce inspectable activation evidence. Do not execute its domain workflow.

## Contract

- Global capabilities contain only narrow, reusable behavior.
- Project paths, rules, commands, credentials, schemas, and rollout gates stay in project AGENTS or repo-local skills.
- Empty `projectScopes` is global; scoped profiles render to project `.agents/skills` and `.codex/config.toml`.
- Personal capabilities outside governance must be named in the machine audit allowlist.

Identify source, risk, overlap, affected projects, and runtime effects. Choose one disposition: global, project-scoped, reference-only, explicit mode, deprecated, blocked, or rejected. Apply the smallest durable change across the relevant registry, profile, runtime, and project layers.

Verify schema/tests, trigger and anti-trigger cases, rendered global and project state, runtime truth, and cleanup. Static trigger matching is lint; behavioral claims require representative live evidence.

For external intake or multi-project changes, read [references/adoption-checklist.md](references/adoption-checklist.md).

Fail the review if scope leaks globally, layers duplicate ownership, obsolete declarations remain, or a broad workflow captures ordinary tasks.
