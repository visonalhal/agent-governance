---
name: skill-audit
description: Use when evaluating, adopting, updating, deprecating, or comparing AI skills, agent plugins, trigger rules, runtime profiles, or skill governance records.
---

# Skill Audit

Audit skills by runtime impact, not popularity.

## Check

- Source: discovery catalog vs canonical upstream.
- Runtime effect: prompt-only, local scripts, network, credentials, filesystem writes, hooks, auto-update.
- Trigger quality: clear triggers, clear anti-triggers, no mandatory overreach.
- Overlap: which existing skill it replaces or conflicts with.
- Project fit: which profiles may enable it and which must only reference it.

## Decision

- Approve only pinned, reviewed, scoped capabilities.
- Mark broad process frameworks as source-only unless their trigger rules are safe.
- Prefer small self-owned skills for recurring personal workflows.
