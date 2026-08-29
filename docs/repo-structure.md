# Repository Structure

`agent-governance` treats this repo as the authoritative source for governed agent assets and policies. Everything else is either rendered output or machine-local state.

If you want the shortest "how do I read this codebase?" path, read `docs/how-to-read-this-repo.md` first and come back here for directory detail.

## Source of Truth

- `assets/`
  Source-controlled active assets that the repo owns and may publish.
  Capability assets live under `assets/skills/`, `assets/commands/`, `assets/agents/`, and `assets/plugins/`.
  Runtime-specific plugin payloads stay colocated under `assets/plugins/<plugin>/targets/<runtime>/`.
- `registry/`
  Capability records, discovery sources, and governance metadata for every managed item.
  `registry/capabilities/` is organized by `kind[/namespace]/name.yaml`.
- `locks/`
  Published resolution lock plus historical snapshots used for deterministic rollback.
- `archive/deprecated-capabilities/`
  Inactive payloads retained only for traceability. Normal repository search excludes this tree;
  deprecated registry tombstones remain searchable under `registry/`.

## Rendered Output

- `generated/`
  Derived output only. `render` rebuilds `generated/shared-cache/` and `generated/machines/<machineId>/`.

Generated files are not hand-edited and never become source of truth.

## Machine and Runtime Definitions

- `machines/`
  Machine profiles, enabled runtimes, and machine-specific path overrides.
- `runtimes/`
  Runtime adapter definitions and merge behavior for Codex, Cursor, Claude, and review-only profiles.
- `policies/`
  Governance policy documents and runtime contracts, including the versioned Codex global `AGENTS.md` source.

## Implementation

- `src/`
  TypeScript governance engine and runtime adapters.
- `scripts/`
  CLI entrypoints such as `pnpm governance`.
- `tests/`
  End-to-end governance tests and fixtures.
- `docs/`
  Operational guides, structure notes, and roadmap documents.

## Source Priority

When the same concept appears in multiple places, the precedence is:

1. Active source under `assets/` and `policies/`, plus metadata and published state under `registry/` and `locks/`
2. Rendered output under `generated/`
3. Local runtime config under `~/.codex`, `~/.cursor`, `~/.claude`, project `.codex` overlays, and cache state under `~/.cache/agent-governance`

`import-local` is the adoption path for existing local state. It is not the long-term editing surface.

## Governance Model

- `skill`, `mcp`, `command`, `agent`, and `plugin` are first-class capabilities.
- Capability records stay runtime-agnostic; selectable abstract bindings live on the capability itself.
- Runtime-specific activation and binding choice live in `runtimes/*.yaml` and the rendered runtime state.
