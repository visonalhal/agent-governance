# How To Read This Repo

This repo feels bigger than it really is because it mixes three concerns in one place:

1. governance source of truth
2. runtime-specific packaging details
3. generated output and bootstrap/import tooling

The good news is that the real execution path is much smaller than the full directory tree.

## Mental Model

Think in four layers:

1. `registry/` + `assets/`
   This is the authored source of truth. Capabilities, runtime policies, and canonical asset payloads live here.
2. `locks/`
   `publish` turns approved capabilities into a deterministic resolution lock.
3. `generated/`
   `render` turns the lock plus machine/runtime config into shared-cache artifacts and per-runtime desired state.
4. local runtime config under `~/.codex`, `~/.cursor`, `~/.claude`, project `.codex` overlays, plus the independent governance cache
   `sync` merges the rendered desired state into real runtime-native config files.

The shortest way to think about the whole system is:

`source` -> `publish` -> `render` -> `sync`

## Read Order

When you come back to this repo after a while, this is the shortest path back in:

1. `README.md`
   Re-establish the operating model and command names.
2. `src/schema.ts`
   This is the vocabulary of the whole system: capability, runtime, machine, lock, rendered state.
3. `src/governance.ts`
   This is the main lifecycle orchestrator: ingest, review, approve, publish, render, sync, audit.
4. `src/runtime-adapters.ts`
   This shows how rendered state is merged into Codex, Cursor, and Claude native files.
5. `runtimes/*.yaml`
   These files explain which capabilities each runtime enables and how bindings are chosen.
6. `machines/*.yaml`
   These files explain where rendered state lands for a specific machine.
7. `src/local-import.ts`
   Only read this when you are working on bootstrap/adoption from existing local state. It matters, but it is not the hot path for normal governance changes.

## What Each Core File Does

- `src/schema.ts`
  Defines the canonical data model with Zod. If a concept is fuzzy, start here before reading implementation.
- `src/governance.ts`
  Owns the main workflows:
  `ingestCapability`, `reviewCapability`, `approveCapability`, `publishGovernance`, `renderGovernance`, `syncGovernance`, `auditGovernance`.
- `src/runtime-adapters.ts`
  Owns the last mile into runtime-native files and collision protection with unmanaged local config.
- `src/local-import.ts`
  Adopts existing local state into governed state. It seeds skills, plugins, MCPs, secrets, runtime policy overrides, and owned-state files.
- `src/io.ts`
  Small filesystem and serialization helpers.
- `scripts/governance.ts`
  Thin CLI wrapper over `src/governance.ts` and `src/local-import.ts`.

## Which Directories Matter Most

Read often:

- `src/`
- `scripts/`
- `registry/`
- `runtimes/`
- `machines/`
- `tests/`
- `docs/skills-capability-map.md`
  Read this when you need to understand skill boundaries, overlap, orchestration rules, and selection guidance without digging through every `SKILL.md`.

Read sometimes:

- `assets/`
  Important when changing the actual governed payload of a skill, plugin, command, or agent.
- `policies/`
  Important when changing review/risk rules or templates.
- `docs/`
  Operational notes and design intent.

Usually ignore unless debugging packaging or render output:

- `generated/`
  Derived output only.
- `locks/history/`
  Historical snapshots.
- `assets/plugins/*/targets/*`
  Runtime-specific packaged payloads that add a lot of visual noise.

## Common Tasks

Add or update a capability:

1. edit or add the asset under `assets/`
2. edit or add the capability record under `registry/capabilities/`
3. enable it in one or more `runtimes/*.yaml` files if needed
4. run `pnpm governance review` / `approve` / `publish`
5. run `pnpm governance render`
6. run `pnpm governance sync --runtime <id>` when you want to apply it locally

Understand why something appears in a runtime:

1. look in `runtimes/<runtime>.yaml` for `enabledCapabilities`
2. inspect the capability's `bindings`
3. inspect `renderGovernance` and `resolveBindingForRuntime` in `src/governance.ts`
4. inspect the matching adapter in `src/runtime-adapters.ts`

## Fast Glossary

- capability: a governed unit such as a skill, plugin, MCP, command, or agent
- binding: the runtime-specific activation shape for a capability
- runtime: Codex, Cursor, Claude, or another target environment
- machine: a concrete workstation profile that enables some runtimes and path templates
- lock: the published, deterministic set of approved capabilities
- rendered state: per-runtime desired configuration derived from lock + machine + runtime policy
- sync: merge the rendered state into runtime-native config files

## Current Hotspots

If you only want to simplify the codebase mentally, the biggest hotspots are:

- `src/governance.ts`
  Core lifecycle plus many helper functions in one file.
- `src/local-import.ts`
  Large because it handles several runtime-specific import paths and secret extraction rules.
- `tests/governance.test.ts`
  Broad end-to-end coverage, but also large because it mirrors the whole lifecycle.

Rule of thumb:

- normal governance work: stay in `schema -> governance -> runtimes/machines -> runtime-adapters`
- bootstrap/adoption work: add `local-import`
- packaging work: add `assets/plugins/*/targets/*`
