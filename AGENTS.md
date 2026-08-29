# Agent Governance Rules

Governance profile: `agent-governance`. This repository is the source of truth for governed shared capabilities, project profiles, and runtime sync behavior. Project-owned skills remain in their repositories; intentional personal capabilities must be named in the machine audit allowlist.

## Core Model

- The real governance path is registry/assets -> review -> profiles -> publish -> render -> sync -> runtime-audit. Do not change only one layer and claim governance is complete.
- Project `AGENTS.md` files and repo-local skills are local overlays. Shared skill behavior, profile activation, and governed runtime state belong in this repository.
- Profiles with empty `projectScopes` render globally. Scoped profiles must render into the matching repository's `.codex/config.toml`, with Skill paths pointing at the independent governance cache; never simulate project scope by merging them into the global runtime.
- Do not hand-edit `~/.codex/config.toml` or `~/.codex/skills` to bypass governance. Runtime changes must flow through this repository's sync, render, and audit path.
- Community skills and plugins are reviewed inputs only. Do not default-enable anything until source, license, permissions, scripts, and local behavior have been reviewed and pinned.

## Change Boundary

- When adding or changing a capability, check `registry/capabilities/**`, `assets/**`, target `profiles/**`, docs, tests, and generated/lock output together.
- New skills must define clear triggers, anti-triggers, phase, triggerMode, maxChainDepth, subagentRole, and replacement/conflict relationships.
- Never add "1% chance must trigger" style hard gates.
- Original Superpowers workflow skills, the default `build-web-apps` plugin, and `testing-quality` are deprecated, blocked, or default-off. Superpowers may be evaluated only as a separate explicit mode; it must not become a global entrypoint without representative live evidence.
- `webapp-testing` is candidate/reference-only until source, license, permissions, scripts, and local Playwright behavior are reviewed.
- Only the reviewed Impeccable subset should be enabled. Do not default-enable `overdrive`, `delight`, `animate`, `bolder`, or `quieter`.

## Skill Use

- Use `skill-audit` only for capability adoption, lifecycle, permission, overlap, or runtime-scope decisions.
- Use `prompt-master` for prompt or Skill instruction wording and trigger/anti-trigger tests. Do not add `skill-audit` unless the task also changes a capability lifecycle or scope decision.
- Use Codex's native plan and goal mechanisms for multi-file or multi-session governance changes.
- Add focused regression tests for high-risk runtime sync, schema, plugin-disable, lock, or render behavior changes.
- Static trigger matching is a lint, not proof of model behavior. Adoption decisions require representative live runs or Plugin Eval evidence.
- Run the narrowest relevant verification before claiming a governance sync or implementation is complete.
- Do not use `testing-quality` or original Superpowers workflow skills as the default workflow.

## Verification

For schema, profile, runtime, sync, audit, trigger eval, or generated output changes, run:

```bash
pnpm check
pnpm test
pnpm governance publish
pnpm governance render
pnpm governance audit
pnpm governance trigger-eval
pnpm governance behavior-eval --dry-run
pnpm governance runtime-audit --runtime codex --write
```

For pure documentation edits, a narrower check is acceptable, but the final response must state why the full governance chain was not run.

## Project Overlays

- Helix, Mercaso, Prompt Atelier, Nihongo, and other projects keep project-specific behavior in their own `AGENTS.md` files.
- This repository owns the mapping from profiles to projects and the enabled/reference/blocked capability lists.
- If a project `AGENTS.md` conflicts with a generic skill, the project `AGENTS.md` wins.
- If the same conflict appears repeatedly, fix the capability activation metadata or trigger evals instead of relying on manual reminders.
