# Roadmap

This backlog tracks follow-up governance work inside the repo. Each item states the problem, the intended outcome, and the bar for completion.

## Now

### Asset Health Audit and Lint

- Problem: asset validity is currently enforced during publish and audit, but there is no focused lint command or report for repository health.
- Expected result: maintainers can identify invalid assets, missing entry files, and forbidden symlinks before a publish attempt.
- Done when: the repo has a dedicated health check path and the output clearly points to the failing capability and asset path.

### Import-Local Diff Report and Dry Run

- Problem: `import-local` can rewrite a large portion of the managed asset tree without previewing the delta.
- Expected result: maintainers can preview added, removed, skipped, and changed assets before adopting local machine state.
- Done when: a dry-run mode prints a stable summary of changes without mutating repo-tracked files.

## Next

### Capability Provenance and Install Manifest Tightening

- Problem: imported manifests still mix provenance hints, runtime details, and historical install metadata with uneven structure.
- Expected result: capability install manifests become easier to read, compare, and validate across skills, plugins, and MCP entries.
- Done when: imported capability records follow one consistent manifest shape and validation catches missing required provenance fields.

### Project Overlay Workflow

- Problem: the repo documents project overlays conceptually, but the day-to-day workflow is still thin.
- Expected result: project repos can layer project-specific constraints on top of personal governance without redefining the personal marketplace.
- Done when: the docs include a concrete overlay flow, example files, and acceptance criteria for project-local additions.

## Later

### Upstream Drift Audit Expansion

- Problem: upstream drift checks exist, but the audit surface is still narrow and mostly tied to git refs.
- Expected result: maintainers can detect more kinds of upstream drift and stale provenance before they become runtime surprises.
- Done when: audit can report meaningful upstream drift for all supported capability types with actionable remediation guidance.

### Multi-Machine Sync and Rollback Drills

- Problem: the current workflow is proven on one machine, but repeated multi-machine adoption and rollback drills are not yet encoded.
- Expected result: the repo supports repeatable validation for publish, render, sync, and rollback across more than one machine profile.
- Done when: test or documented drill coverage exists for multi-machine adoption, rollback from history, and conflict handling.
