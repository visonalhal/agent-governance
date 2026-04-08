# Agent Governance

`agent-governance` is the single source of truth for personal, cross-runtime governance of `skills`, `plugins`, `MCP`, `commands`, and `agents`.

The repo stores audited capability metadata, abstract capability bindings, runtime adapter profiles, machine profiles, and deterministic locks. Local runtimes keep their own native config files, but they are rendered and synced from this repo instead of being hand-maintained.

If you're trying to get your bearings again, start with `docs/how-to-read-this-repo.md`. It explains the real execution path and which parts of the tree matter most day to day.

## Operating Model

The system is split into three layers:

- True source: this repo under `halvin-workspace/agent-governance`
- Shared artifact cache: `~/.agents`, which stores shared `skills/`, runtime install `packages/`, and `manifests/`
- Runtime native config: `~/.codex/config.toml`, `~/.cursor/mcp.json`, `~/.claude/settings.json`, and related plugin manifests

The flow is always:

1. `ingest` or edit a capability in `registry/capabilities`
2. edit `runtimes/*.yaml` when a runtime needs a different capability activation or binding policy
3. `review` and `approve` it
4. `publish` the global resolution lock
5. `render` for a machine profile
6. `sync` one managed runtime into its native config

## Repository Layout

- `assets/`, `registry/`, and `locks/` are the repo-owned source of truth.
  Canonical assets live under `assets/skills/`, `assets/mcps/` when needed, `assets/commands/`, `assets/agents/`, and `assets/plugins/`.
  Runtime-specific plugin payloads live under `assets/plugins/<plugin>/targets/<runtime>/`.
- `generated/` is derived output only and is rebuilt by `render`.
- `machines/` and `runtimes/` define where rendered state lands.
- `registry/capabilities/` is organized by `kind[/namespace]/name.yaml`.
- `src/` and `scripts/` implement the governance engine.
- `tests/` and `docs/` hold verification and operational guidance.

See `docs/repo-structure.md` for the canonical directory guide.
See `docs/how-to-read-this-repo.md` for the fastest reading order back into the codebase.
See `docs/skills-capability-map.md` for the current skill responsibility map, orchestration flows, and overlap rules.

## Bootstrap

The repo is discovered through a local bootstrap file:

`~/.config/agent-governance/bootstrap.yaml`

Example:

```yaml
repoPath: /Users/halvinshen/Documents/workspace/halvin-workspace/agent-governance
machineId: halvin-macbook-pro
cacheRoot: /Users/halvinshen/.agents
localSecretsFile: /Users/halvinshen/.config/agent-governance/local/halvin-macbook-pro.yaml
```

Secrets and machine-local overrides stay outside Git:

`~/.config/agent-governance/local/<machineId>.yaml`

## Commands

- `pnpm governance ingest`
- `pnpm governance review`
- `pnpm governance approve`
- `pnpm governance publish`
- `pnpm governance render`
- `pnpm governance sync --runtime <runtime>`
- `pnpm governance import-local`
- `pnpm governance audit`
- `pnpm governance deprecate`
- `pnpm governance block`

Use `--bootstrap` to point at a non-default bootstrap file, and `--machine` to render or sync a specific machine profile.

## Managed Runtimes

- `codex`: managed
  Codex keeps governed plugins and MCP servers in `~/.codex/config.toml`, while shared skills remain in `~/.agents/skills`.
- `cursor`: managed
  Cursor gets governed MCP servers in `~/.cursor/mcp.json` and governed custom skills in `~/.cursor/skills`.
- `claude`: managed
  Claude gets governed `enabledPlugins`, `known_marketplaces`, and `installed_plugins` records.
- `gemini`: review_only
  The profile exists in the registry but phase 1 does not sync it.
