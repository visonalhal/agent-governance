# Operations Guide

## First-Time Setup

1. Clone the repo into `halvin-workspace/agent-governance`.
2. Create `~/.config/agent-governance/bootstrap.yaml`.
3. Create `~/.config/agent-governance/local/<machineId>.yaml`.
4. Run `pnpm install`.
5. Run `pnpm governance publish`.
6. Run `pnpm governance render`.
7. Run `pnpm governance sync --runtime codex`, `claude`, or `cursor`.
8. If the workstation already has curated global state you want to adopt, run `pnpm governance import-local`.

## Intake

1. Add or ingest a candidate from a discovery-only catalog.
2. Resolve it to a canonical upstream repo, tag/branch/commit, path, and digest.
3. Fill out review metadata.
4. Approve it only after the capability passes validation.

Discovery sources such as `awesome-skills.com` and `skills.sh` are never used as installation sources.

## Publish

`pnpm governance publish`

This command:

- validates all approved or published capabilities
- writes `locks/resolution.lock.json`
- stores a snapshot under `locks/history/`

`publish` never writes machine-local paths into the global lock.

## Render

`pnpm governance render`

This command:

- rebuilds `generated/shared-cache`
- writes `generated/shared-cache/manifests/shared-cache-manifest.json`
- writes `generated/machines/<machineId>/<runtime>/desired-state.json`

Render is deterministic for a given lock and machine profile.

## Sync

`pnpm governance sync --runtime <runtime>`

This command:

- syncs the rendered shared cache into `~/.agents`
- resolves `${HOME}`, `${WORKSPACE_ROOT}`, `${CACHE_ROOT}`, and `${SECRET:<key>}`
- merges only governed keys into the runtime native config
- refuses to overwrite unmanaged collisions

Current native targets:

- Codex: `~/.codex/config.toml`
- Cursor: `~/.cursor/mcp.json` and `~/.cursor/skills`
- Claude: `~/.claude/settings.json`, `~/.claude/plugins/known_marketplaces.json`, `~/.claude/plugins/installed_plugins.json`

## Source Priority

When something exists in more than one place, the precedence is:

1. This repo under `assets/`, `registry/`, and `locks/`
2. Rendered output under `generated/`
3. Runtime-native config and shared cache on the local machine

Do not treat `generated/` or runtime-native files as the place to make durable edits.

## Import Local State

`pnpm governance import-local`

This command:

- copies the current local shared skill cache and active managed runtime entries into `assets/`
- dereferences imported symlinks so the repo stores real files instead of machine-private links
- skips invalid local skills that do not include `SKILL.md`
- redacts imported secrets into `~/.config/agent-governance/local/<machineId>.yaml`
- publishes and renders the imported state
- seeds local managed-state files so the adopted entries stop colliding as unmanaged config
- syncs the imported state back through the normal governed pipeline

Use `import-local` to adopt existing workstation state. After adoption, edit the repo instead of editing `~/.agents` or runtime-native config files by hand.

## Rollback

1. Pick a previous snapshot under `locks/history/`.
2. Re-render from it:

```sh
pnpm governance render --lock-file locks/history/<snapshot>.lock.json
```

3. Sync the affected runtime again.

This restores both runtime desired state and shared-cache references to the selected historical lock.

## Audit

`pnpm governance audit`

Audit checks for:

- lock drift
- stale reviews
- missing digests
- optional upstream ref drift

## Secrets and Local Overrides

- Git stores capability metadata, not machine secrets.
- Real secrets belong in `~/.config/agent-governance/local/<machineId>.yaml`.
- `runtimeLocalOverrides` can be used for machine-local merge tweaks without changing the repo.
