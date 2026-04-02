# Repository Structure

`agent-governance` treats this repo as the authoritative source for governed agent assets and policies. Everything else is either rendered output or machine-local state.

## Source of Truth

- `assets/`
  Source-controlled skill and package assets that the repo owns and publishes.
- `registry/`
  Capability records, discovery sources, and governance metadata for every managed item.
- `locks/`
  Published resolution lock plus historical snapshots used for deterministic rollback.

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
  Governance policy documents and templates.

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

1. This repo under `assets/`, `registry/`, and `locks/`
2. Rendered output under `generated/`
3. Local runtime config under `~/.codex`, `~/.cursor`, `~/.claude`, and shared cache state under `~/.agents`

`import-local` is the adoption path for existing local state. It is not the long-term editing surface.
