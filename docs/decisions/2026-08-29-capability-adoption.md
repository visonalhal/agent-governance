# Capability Adoption Decision — 2026-08-29

## Decision

Keep the default Codex runtime lean. Adopt project scoping and live behavior evaluation in governance; do not install another workflow suite globally.

| Candidate | Status | Evidence and boundary |
| --- | --- | --- |
| OpenAI Plugin Eval CLI | Reference tool, not runtime plugin | Official `openai/plugins` commit `1e285826e604f66f7208f7ac4dba0fe8341d1f57`; deterministic analysis improved `agent-governance` from B/86 and 1132 active tokens to A/100 and 381 active tokens. Use from a pinned checkout when needed. |
| OpenAI Plugin Eval chat plugin | Deferred | Current upstream skill text contains a hard-coded `/Users/benlesh/...` path and searches legacy `~/.codex/skills` before the current user skill directory. Installing it would add routing noise and a known portability defect. |
| Superpowers | Explicit-mode candidate only | Officially curated but process-heavy. The global disable policy remains. Do not create an explicit mode until native-vs-candidate live runs show better outcomes without unacceptable planning, tool, worktree, TDD, or subagent overhead. |
| Matt Pocock TDD/diagnosis skills | Deferred | More modular than Superpowers, but overlaps native behavior and project rulebooks. Consider one project-local explicit pilot only after a repeated failure is captured as an eval. |
| Vercel React/Next skill suite | Not adopted | Existing `next-best-practices`, `frontend-design`, and project docs cover the maintained need. The added context and overlap are not justified. |
| GitHub plugin | On-demand candidate | Useful for PR/Issue/CI work, but not a stability mechanism. Evaluate in a PR-heavy project before enabling it. |
| CircleCI plugin | Adopted, project-scoped | Enabled only in Mercaso profiles and removed from global config. |
| Context7 MCP | Retained for Cursor | Current official endpoint and bearer authentication verified. It is the sole global Cursor documentation MCP. |
| Clerk MCP | Inventory only | Official endpoint is valid, but the capability is Clerk-specific and therefore removed from global Cursor activation until a real project scope is defined. |
| Legacy GitHub MCP | Deprecated | The old `@modelcontextprotocol/server-github` configuration is replaced upstream by GitHub's official `github-mcp-server`; do not migrate implicitly. |
| Full Impeccable plugin | Deprecated | Its broad Claude activation duplicates the reviewed project-scoped `clarify` and `frontend-design` skills and reintroduces routing noise. |

## Acceptance gate for a workflow candidate

Use the same representative prompts with native Codex and the candidate. Keep the candidate only when it improves task success or first-pass quality and does not materially increase unnecessary questions, plans, Skill reads, tool calls, retries, elapsed time, or scope violations.

Static structure and token scores are supporting evidence. They cannot replace live outcome evidence.

Review expiry blocks only capabilities active on at least one managed machine. Dormant inventory still requires a valid digest and publish checks, but it does not create fake runtime urgency.

## Live baseline

The 2026-08-29 isolated `codex exec` suite passed all six scenarios. Simple technical explanation and Nihongo content prompts used zero Skills and zero tools; explicit governance preserved the `projectScopes`/`.codex/config.toml` boundary; prompt auditing read only `prompt-master` once. Two workspace-write fixtures also proved that implementation and bug-fix requests changed only the intended source file, left tests untouched, ran `node --test`, and did not add wait/skip workarounds. The report is written to `generated/behavior-evals/latest.json` by `pnpm governance behavior-eval --write`.

This proves the current native baseline, not a candidate workflow improvement. Superpowers and other deferred candidates remain disabled until the same suite plus task-specific outcome cases show a measurable benefit.
