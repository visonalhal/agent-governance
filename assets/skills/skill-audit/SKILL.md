---
name: skill-audit
description: Use only when deciding whether to adopt, update, deprecate, block, or scope an AI skill, plugin, MCP, agent, or runtime profile. Do not use for prompt wording or trigger/anti-trigger writing without a capability lifecycle decision.
---

# Skill Audit

Audit skills by runtime impact, not popularity.

This is a capability-governance workflow, not a general prompt or instruction review. Use `prompt-master` when the requested outcome is rewritten prompt text or trigger tests and no adoption, lifecycle, permission, or scope decision is required.

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
- Do not inspect unrelated registry inventory when the named capability and decision are already clear.
