# Project Overlay Model

Project repositories do not redefine the personal marketplace. They constrain how governed capabilities may be used inside that project.

## Precedence

1. System/developer instructions
2. User request
3. Project `AGENTS.md`
4. Active governance profile
5. Capability `activation` metadata
6. Generic skill body

Project `AGENTS.md` wins over generic skills. If Mercaso harness rules ban a selector pattern, generic Playwright advice cannot override it. If Helix says intent classification comes first, a workflow skill cannot jump directly into debugging.

## What Belongs In Project Overlays

- project-only allowlists or blocklists
- project-specific precedence rules
- project-scoped skills
- local verification commands
- additional review gates
- domain rulebooks such as the Mercaso harness contract

## What Stays In Agent Governance

- shared capability metadata
- source, risk, permission, and lifecycle review
- runtime adapters
- machine profiles
- active profile selection
- lock, render, sync, and runtime audit

## Current Project Mapping

| Project | Profile | Overlay Rule |
| --- | --- | --- |
| Helix | `helix-product` | `helix/AGENTS.md` is the workflow contract; local URLs and repo paths are internal resources |
| Mercaso Web | `mercaso-web` | project `AGENTS.md` and repo conventions beat generic React/Playwright guidance |
| Mercaso Harness | `mercaso-harness` | `premier-store-os-ts*` harness work uses the rulebook as the source of truth for selectors, fixtures, seeds, and verification |
| Agent Governance | `agent-governance` | schema/profile/runtime changes need tests and audit |
| Prompt Atelier | `prompt-atelier` | image production loop stays project-local |
| Nihongo N3 Compass | `nihongo-content` | content-first study notes; generated vocabulary output must flow from data/scripts |

## Failure Signals

- A generic skill contradicts project `AGENTS.md`.
- A simple command triggers planning or debugging.
- A project-local URL is treated as an external web source.
- A profile enables a broad workflow skill with no anti-triggers.
- Runtime audit shows active plugin skills that are not governed or explicitly allowed.
