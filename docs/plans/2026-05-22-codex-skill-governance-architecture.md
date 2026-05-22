# Codex Skill Governance Architecture Plan

## Problem

`agent-governance` previously tracked capabilities, but Codex runtime reality still came from
`~/.codex/config.toml`, `~/.codex/skills`, and plugin cache state. That made the registry look
narrow while the actual session could still load heavy process plugins such as Superpowers and
Build Web Apps.

The real failure mode was not "too many skills"; it was missing activation governance:

- no runtime truth audit
- no profile layer for project-specific activation
- no distinction between enabled, reference-only, and blocked capabilities
- no Codex user-skill sync into `~/.codex/skills`
- no trigger evals for over-eager workflow skills

## Target Architecture

The governance path is:

`registry + assets -> review -> profiles -> publish -> render -> sync -> runtime audit`

Profiles decide what a machine/runtime actually activates. Runtime config only describes the
runtime adapter and minimal base capabilities.

## First Implementation Milestones

1. Add activation metadata to capabilities.
2. Add runtime profiles and machine `activeProfiles`.
3. Sync governed Codex user skills into `~/.codex/skills`.
4. Add runtime truth audit for Codex.
5. Add trigger eval scenarios for debug vs non-debug prompts.
6. Deprecate heavyweight workflow skills and introduce self-owned lite skills.
7. Disable `build-web-apps@openai-curated` and `superpowers@openai-curated`.

## Deprecations

- `skill.testing-quality`
- `skill.brainstorming`
- `skill.writing-plans`
- `skill.systematic-debugging`
- `skill.requesting-code-review`
- `skill.receiving-code-review`
- default Codex activation of `build-web-apps@openai-curated`
- default Codex activation of `superpowers@openai-curated`

## Keep List

- Tool-style plugins and MCPs when explicitly useful, such as Browser, GitHub, Figma, and Drive.
- Project-local `AGENTS.md` files as the highest-priority project workflow contract.
- Selected Impeccable design skills only: `frontend-design`, `critique`, `polish`, `harden`,
  `clarify`, `typeset`, and `normalize`.
- `webapp-testing` as candidate/reference-only until its source, scripts, permissions, and local
  Playwright behavior are reviewed.

## Acceptance Criteria

- Rendered Codex desired state disables Build Web Apps and Superpowers.
- `testing-quality` does not appear in active Codex profile output.
- Governed Codex skills render as user-dir skills and sync into `~/.codex/skills`.
- Runtime audit reports drift between actual Codex state and rendered desired state.
- Trigger evals reject debugging on clone/config/meta prompts and require debugging on flaky/failure prompts.
