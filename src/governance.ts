import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AnyResolutionLock,
  BootstrapRecord,
  CapabilityRecord,
  LegacyResolutionLock,
  LocalSecretsRecord,
  MachineRecord,
  RenderedProjectRuntimeState,
  RenderedRuntimeState,
  ResolutionLock,
  RuntimeProfileRecord,
  RuntimeRecord,
  SharedCacheManifest,
  SourceRecord,
} from "./schema.js";
import {
  bootstrapSchema,
  capabilitySchema,
  legacyResolutionLockSchema,
  localSecretsSchema,
  machineSchema,
  renderedProjectRuntimeStatesSchema,
  renderedRuntimeStateSchema,
  resolutionLockSchema,
  runtimeProfileSchema,
  runtimeSchema,
  sharedCacheManifestSchema,
  sourcesFileSchema,
} from "./schema.js";
import {
  computeDirectoryDigest,
  copyDirectory,
  ensureDir,
  listAbsoluteSymlinks,
  listFiles,
  listTopLevelEntries,
  normalizePosix,
  pathExists,
  readJsonFile,
  readText,
  readYamlFile,
  removePath,
  stableJson,
  writeJsonFile,
  writeYamlFile,
  writeText,
} from "./io.js";
import {
  syncClaudeRuntime,
  syncCodexGlobalAgents,
  syncCodexProjectTrust,
  syncCodexRuntime,
  syncCursorRuntime,
  syncSharedArtifactCache,
} from "./runtime-adapters.js";

const execFileAsync = promisify(execFile);
const CACHE_STATE_FILE = ".agent-governance-cache-state.json";
const CODEX_GLOBAL_AGENTS_SOURCE = path.join("policies", "codex", "global-AGENTS.md");

function requiredRuntimePath(value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`Missing required runtime path for ${label}.`);
  }
  return value;
}

// Main governance lifecycle orchestration lives here:
// registry authoring -> approval/publish -> machine render -> runtime sync -> audit.
// Public entrypoints stay near the top of the file; helpers are grouped lower down.

type RepoState = {
  root: string;
  sources: Map<string, SourceRecord>;
  capabilities: CapabilityRecord[];
  runtimes: Map<string, RuntimeRecord>;
  profiles: Map<string, RuntimeProfileRecord>;
  machines: Map<string, MachineRecord>;
};

type ResolvedContext = {
  root: string;
  bootstrapPath: string | null;
  bootstrap: BootstrapRecord | null;
};

export type IngestInput = {
  id: string;
  name: string;
  assetKind: CapabilityRecord["assetKind"];
  runtimeTargets: string[];
  discoverySources: string[];
  discoveryUrl?: string;
  canonicalSourceId: string;
  canonicalUrl: string;
  canonicalRef: string;
  canonicalRefType: "branch" | "tag" | "commit";
  canonicalPath: string;
  artifactName?: string;
  sourcePath?: string;
  riskTier: CapabilityRecord["riskTier"];
  tags: string[];
};

export type ReviewInput = {
  reviewer?: string;
  reviewedAt?: string;
  license?: string;
  status?: CapabilityRecord["review"]["status"];
  executesScripts?: boolean;
  networkAccess?: boolean;
  touchesCredentials?: boolean;
  filesystemSideEffects?: string;
  notes: string[];
  hydrateHash?: boolean;
};

export type AuditOptions = {
  staleDays: number;
  checkUpstream: boolean;
};

// Repository discovery and loading.
export async function resolveContext(options: {
  root?: string;
  bootstrapPath?: string;
} = {}): Promise<ResolvedContext> {
  if (options.root) {
    return {
      root: path.resolve(options.root),
      bootstrapPath: options.bootstrapPath ? path.resolve(options.bootstrapPath) : null,
      bootstrap: options.bootstrapPath ? await loadBootstrap(path.resolve(options.bootstrapPath)) : null,
    };
  }

  const bootstrapPath = options.bootstrapPath
    ? path.resolve(options.bootstrapPath)
    : (await pathExists(getDefaultBootstrapPath()))
      ? getDefaultBootstrapPath()
      : null;

  if (bootstrapPath) {
    const bootstrap = await loadBootstrap(bootstrapPath);
    return {
      root: path.resolve(bootstrap.repoPath),
      bootstrapPath,
      bootstrap,
    };
  }

  return {
    root: process.cwd(),
    bootstrapPath: null,
    bootstrap: null,
  };
}

export async function loadRepo(root: string): Promise<RepoState> {
  const sourcesFile = await readYamlFile<unknown>(path.join(root, "registry", "sources.yaml"));
  const parsedSources = sourcesFileSchema.parse(sourcesFile);
  const capabilityFiles = await listFiles(path.join(root, "registry", "capabilities"), ".yaml");
  const runtimeFiles = await listFiles(path.join(root, "runtimes"), ".yaml");
  const profileFiles = await listFiles(path.join(root, "profiles"), ".yaml");
  const machineFiles = await listFiles(path.join(root, "machines"), ".yaml");

  const capabilities = await Promise.all(
    capabilityFiles.map(async (filePath) => capabilitySchema.parse(await readYamlFile(filePath)))
  );
  const runtimes = await Promise.all(
    runtimeFiles.map(async (filePath) => runtimeSchema.parse(await readYamlFile(filePath)))
  );
  const profiles = await Promise.all(
    profileFiles.map(async (filePath) => runtimeProfileSchema.parse(await readYamlFile(filePath)))
  );
  const machines = await Promise.all(
    machineFiles.map(async (filePath) => machineSchema.parse(await readYamlFile(filePath)))
  );

  return {
    root,
    sources: new Map(parsedSources.sources.map((record) => [record.id, record])),
    capabilities: capabilities.sort((left, right) => left.id.localeCompare(right.id)),
    runtimes: new Map(runtimes.map((record) => [record.runtimeId, record])),
    profiles: new Map(profiles.map((record) => [record.profileId, record])),
    machines: new Map(machines.map((record) => [record.machineId, record])),
  };
}

export function capabilityFilePath(root: string, id: string) {
  return path.join(root, "registry", "capabilities", ...registryPathSegmentsFromId(id));
}

export async function ingestCapability(root: string, input: IngestInput) {
  const repo = await loadRepo(root);
  if (repo.sources.has(input.id)) {
    throw new Error(`Capability id ${input.id} collides with a source id.`);
  }
  if (!repo.sources.has(input.canonicalSourceId)) {
    throw new Error(`Unknown canonical source ${input.canonicalSourceId}.`);
  }

  const missingDiscovery = input.discoverySources.filter((sourceId) => !repo.sources.has(sourceId));
  if (missingDiscovery.length > 0) {
    throw new Error(`Unknown discovery sources: ${missingDiscovery.join(", ")}.`);
  }

  const filePath = capabilityFilePath(root, input.id);
  if (await pathExists(filePath)) {
    throw new Error(`Capability already exists: ${input.id}.`);
  }

  const capability = capabilitySchema.parse({
    id: input.id,
    name: input.name,
    assetKind: input.assetKind,
    bindings: defaultBindingsForAssetKind(input.assetKind),
    discoverySources: input.discoverySources,
    canonicalSource: {
      sourceId: input.canonicalSourceId,
      url: input.canonicalUrl,
      ref: input.canonicalRef,
      refType: input.canonicalRefType,
      path: input.canonicalPath,
    },
    install: {
      strategy: input.assetKind === "mcp" ? "manifest" : "copy",
      artifactName: input.artifactName ?? input.id.split(".").at(-1) ?? input.id,
      sourcePath: input.sourcePath,
      manifest: input.discoveryUrl ? { discoveryUrl: input.discoveryUrl } : undefined,
    },
    riskTier: input.riskTier,
    permissions: inferPermissions(input.riskTier),
    review: {
      status: "pending",
      notes: [],
    },
    lifecycleState: "candidate",
    versionPolicy: {
      strategy: "pin-ref-and-hash",
      allowUpdates: "manual",
    },
    hash: {
      algorithm: "sha256",
    },
    tags: input.tags,
  });

  await writeYamlFile(filePath, capability);
  if (input.runtimeTargets.length > 0) {
    await enableCapabilityForRuntimes(root, input.id, input.runtimeTargets);
  }
  return filePath;
}

export async function reviewCapability(root: string, id: string, input: ReviewInput) {
  const { capability, filePath } = await loadCapabilityById(root, id);
  const next = capabilitySchema.parse({
    ...capability,
    review: withDefinedValues({
      ...capability.review,
      reviewer: input.reviewer ?? capability.review.reviewer,
      reviewedAt: input.reviewedAt ?? capability.review.reviewedAt,
      license: input.license ?? capability.review.license,
      status: input.status ?? capability.review.status,
      executesScripts: input.executesScripts ?? capability.review.executesScripts,
      networkAccess: input.networkAccess ?? capability.review.networkAccess,
      touchesCredentials: input.touchesCredentials ?? capability.review.touchesCredentials,
      filesystemSideEffects:
        input.filesystemSideEffects ?? capability.review.filesystemSideEffects,
      notes: [...capability.review.notes, ...input.notes],
    }),
  });

  if (input.hydrateHash && next.install.sourcePath) {
    const digest = await computeDirectoryDigest(resolveAssetPath(root, next.install.sourcePath));
    next.hash = {
      algorithm: "sha256",
      digest,
    };
  }

  if (next.lifecycleState === "candidate") {
    next.lifecycleState = "under_review";
  }

  await writeYamlFile(filePath, next);
  return buildCapabilityReport(next, await loadRepo(root));
}

export async function approveCapability(root: string, id: string) {
  const repo = await loadRepo(root);
  const { capability, filePath } = await loadCapabilityById(root, id);
  if (capability.lifecycleState === "blocked") {
    throw new Error(`Blocked capability ${id} cannot be approved.`);
  }

  const errors = validateCapabilityForApproval(repo, capability);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  await writeYamlFile(
    filePath,
    capabilitySchema.parse({
      ...capability,
      lifecycleState: "approved",
    })
  );
}

export async function changeCapabilityLifecycle(
  root: string,
  id: string,
  lifecycleState: CapabilityRecord["lifecycleState"],
  reason?: string
) {
  const { capability, filePath } = await loadCapabilityById(root, id);
  if (lifecycleState === "approved") {
    throw new Error("Use approve for approval transitions.");
  }

  await writeYamlFile(
    filePath,
    capabilitySchema.parse(
      withDefinedValues({
        ...capability,
        lifecycleState,
        statusReason: reason,
      })
    )
  );
}

export async function publishGovernance(root: string) {
  const repo = await loadRepo(root);
  const publishableCapabilities = repo.capabilities.filter(
    (capability) =>
      capability.lifecycleState === "approved" || capability.lifecycleState === "published"
  );

  const publishErrors = publishableCapabilities.flatMap((capability) =>
    validateCapabilityForPublish(repo, capability)
  );
  const runtimeErrors = [...repo.runtimes.values()].flatMap((runtime) =>
    validateRuntimeConfig(repo, runtime)
  );
  const profileErrors = validateProfiles(repo);
  const machineErrors = [...repo.machines.values()].flatMap((machine) => validateMachineConfig(repo, machine));
  if (publishErrors.length > 0 || runtimeErrors.length > 0 || profileErrors.length > 0 || machineErrors.length > 0) {
    throw new Error([...publishErrors, ...runtimeErrors, ...profileErrors, ...machineErrors].join("\n"));
  }

  const assetErrors = (
    await Promise.all(publishableCapabilities.map((capability) => validateCopyInstallAsset(root, capability)))
  ).flat();
  if (assetErrors.length > 0) {
    throw new Error(assetErrors.join("\n"));
  }

  for (const capability of publishableCapabilities) {
    if (capability.lifecycleState === "approved") {
      await writeYamlFile(
        capabilityFilePath(root, capability.id),
        capabilitySchema.parse({
          ...capability,
          lifecycleState: "published",
        })
      );
    }
  }

  const refreshedRepo = await loadRepo(root);
  const publishedCapabilities = refreshedRepo.capabilities.filter(
    (capability) => capability.lifecycleState === "published"
  );
  const lock = buildResolutionLock(publishedCapabilities);
  const lockPath = path.join(root, "locks", "resolution.lock.json");
  await writeText(lockPath, stableJson(lock));

  const historyDir = path.join(root, "locks", "history");
  await ensureDir(historyDir);
  const snapshotName = `${new Date().toISOString().replace(/[:]/g, "-")}.lock.json`;
  await writeText(path.join(historyDir, snapshotName), stableJson(lock));
  return lock;
}

export async function renderGovernance(options: {
  root: string;
  machineId: string;
  bootstrap: BootstrapRecord;
  lockFile?: string;
}) {
  await pruneGeneratedRoot(options.root);
  const repo = await loadRepo(options.root);
  const machine = getMachineOrThrow(repo, options.machineId);
  const lock = await readResolutionLock(
    options.lockFile ?? path.join(options.root, "locks", "resolution.lock.json")
  );

  await rebuildSharedCache(options.root, lock, repo, machine);
  const sharedCacheManifest = await buildSharedCacheManifest(options.root, lock, repo, machine);

  const generatedMachineRoot = path.join(options.root, "generated", "machines", machine.machineId);
  await removePath(generatedMachineRoot);
  await ensureDir(generatedMachineRoot);

  const vars = buildPathVars(options.bootstrap, machine);
  const renderedStates: RenderedRuntimeState[] = [];
  const projectStates: RenderedProjectRuntimeState[] = [];

  for (const runtimeId of machine.enabledRuntimes) {
    const runtime = repo.runtimes.get(runtimeId);
    if (!runtime) {
      throw new Error(`Machine ${machine.machineId} references unknown runtime ${runtimeId}.`);
    }

    const rendered = renderedRuntimeStateSchema.parse(
      deepMerge(
        buildRenderedRuntimeState({
          runtime,
          repo,
          machine,
          bootstrap: options.bootstrap,
          lock,
          vars,
        }),
        asObject(machine.runtimeOverrides[runtimeId])
      )
    );
    const outputPath = path.join(generatedMachineRoot, runtimeId, "desired-state.json");
    await writeJsonFile(outputPath, rendered);
    renderedStates.push(rendered);

    if (runtime.runtimeId === "codex") {
      for (const projectScope of getActiveProjectScopes(repo, runtime, machine)) {
        const projectState = renderedRuntimeStateSchema.parse(
          buildRenderedRuntimeState({
            runtime,
            repo,
            machine,
            bootstrap: options.bootstrap,
            lock,
            vars,
            projectScope,
          })
        );
        projectStates.push({ projectScope, state: projectState });
      }
      await writeJsonFile(
        path.join(generatedMachineRoot, runtimeId, "project-scopes.json"),
        renderedProjectRuntimeStatesSchema.parse(
          projectStates.filter((entry) => entry.state.runtimeId === runtimeId)
        )
      );
    }
  }

  return {
    lock,
    sharedCacheManifest,
    renderedStates,
    projectStates,
  };
}

export async function syncGovernance(options: {
  root: string;
  machineId: string;
  runtimeId: string;
  bootstrap: BootstrapRecord;
}) {
  const repo = await loadRepo(options.root);
  const machine = getMachineOrThrow(repo, options.machineId);
  const localSecrets = await loadLocalSecrets(options.bootstrap.localSecretsFile);
  const vars = buildPathVars(options.bootstrap, machine);
  const sharedCacheDir = path.join(options.root, "generated", "shared-cache");
  if (!(await pathExists(sharedCacheDir))) {
    throw new Error("Shared cache has not been rendered. Run `pnpm governance render` first.");
  }

  const cacheStateFile = path.join(options.bootstrap.cacheRoot, CACHE_STATE_FILE);
  await syncSharedArtifactCache(sharedCacheDir, options.bootstrap.cacheRoot, cacheStateFile);

  const desiredStatePath = path.join(
    options.root,
    "generated",
    "machines",
    machine.machineId,
    options.runtimeId,
    "desired-state.json"
  );
  if (!(await pathExists(desiredStatePath))) {
    throw new Error(
      `Missing rendered runtime state at ${desiredStatePath}. Run \`pnpm governance render --machine ${machine.machineId}\` first.`
    );
  }

  const unresolvedState = renderedRuntimeStateSchema.parse(
    await readJsonFile<RenderedRuntimeState>(desiredStatePath)
  );
  const locallyOverriddenState = renderedRuntimeStateSchema.parse(
    deepMerge(unresolvedState, asObject(localSecrets.runtimeLocalOverrides[options.runtimeId]))
  );
  const resolvedState = renderedRuntimeStateSchema.parse(
    resolveTemplates(locallyOverriddenState, vars, localSecrets.secrets, true)
  );
  const runtime = repo.runtimes.get(options.runtimeId);
  if (!runtime) {
    throw new Error(`Unknown runtime ${options.runtimeId}.`);
  }
  if (runtime.profileMode !== "managed") {
    throw new Error(`Runtime ${options.runtimeId} is review_only and cannot be synced.`);
  }

  switch (runtime.mergeStrategy) {
    case "codex-toml":
      await syncCodexGlobalAgents(
        path.join(options.root, CODEX_GLOBAL_AGENTS_SOURCE),
        requiredRuntimePath(resolvedState.nativeFiles.globalAgents, "Codex global AGENTS"),
        path.join(path.dirname(resolvedState.ownedStateFile), "codex-global-agents.json")
      );
      await syncCodexRuntime(resolvedState);
      await syncCodexProjectStates({
        root: options.root,
        machineId: machine.machineId,
        runtimeId: runtime.runtimeId,
        globalConfigPath: requiredRuntimePath(resolvedState.nativeFiles.config, "Codex config"),
        vars,
        localSecrets,
      });
      return;
    case "cursor-json":
      await syncCursorRuntime(resolvedState);
      return;
    case "claude-json":
      await syncClaudeRuntime(resolvedState);
      return;
    default:
      throw new Error(`Runtime ${runtime.runtimeId} is not syncable.`);
  }
}

async function syncCodexProjectStates(args: {
  root: string;
  machineId: string;
  runtimeId: string;
  globalConfigPath: string;
  vars: Record<string, string>;
  localSecrets: LocalSecretsRecord;
}) {
  const projectStatesPath = path.join(
    args.root,
    "generated",
    "machines",
    args.machineId,
    args.runtimeId,
    "project-scopes.json"
  );
  const unresolvedProjectStates = (await pathExists(projectStatesPath))
    ? renderedProjectRuntimeStatesSchema.parse(await readJsonFile(projectStatesPath))
    : [];
  const projectStates = unresolvedProjectStates.map((entry) => ({
    projectScope: entry.projectScope,
    state: renderedRuntimeStateSchema.parse(
      resolveTemplates(
        deepMerge(entry.state, asObject(args.localSecrets.runtimeLocalOverrides[args.runtimeId])),
        args.vars,
        args.localSecrets.secrets,
        true
      )
    ),
  }));

  const indexPath = projectRuntimeIndexFile(args.runtimeId, args.vars);
  const previousProjectStates = (await pathExists(indexPath))
    ? renderedProjectRuntimeStatesSchema.parse(await readJsonFile(indexPath))
    : [];
  const activeProjectStates = projectStates.filter((entry) => hasManagedRuntimeEntries(entry.state));
  const activeScopes = new Set(activeProjectStates.map((entry) => entry.projectScope));

  for (const previous of previousProjectStates) {
    if (activeScopes.has(previous.projectScope)) {
      continue;
    }
    await syncCodexRuntime({
      ...previous.state,
      skills: [],
      plugins: [],
      mcps: [],
    });
    await removePath(previous.state.ownedStateFile);
  }

  for (const projectState of activeProjectStates) {
    await syncCodexRuntime(projectState.state);
  }
  await syncCodexProjectTrust(
    args.globalConfigPath,
    path.join(
      args.vars.HOME!,
      ".config",
      "agent-governance",
      "state",
      args.machineId,
      "codex-project-trust.json"
    ),
    [...activeScopes]
  );
  await writeJsonFile(indexPath, renderedProjectRuntimeStatesSchema.parse(activeProjectStates));
}

export async function auditGovernance(root: string, options: AuditOptions) {
  const repo = await loadRepo(root);
  const activeCapabilityIds = new Set(
    [...repo.machines.values()].flatMap((machine) => [...getMachineEnabledCapabilityIds(repo, machine)])
  );
  const publishedCapabilities = repo.capabilities.filter(
    (capability) => capability.lifecycleState === "published"
  );
  const generatedLock = buildResolutionLock(publishedCapabilities);
  const onDiskLock = await readResolutionLock(path.join(root, "locks", "resolution.lock.json"));
  const findings: string[] = [];

  if (stableJson(generatedLock) !== stableJson(onDiskLock)) {
    findings.push("Lock drift: resolution.lock.json does not match the current published registry state.");
  }

  for (const capability of repo.capabilities.filter(
    (item) => item.lifecycleState === "approved" || item.lifecycleState === "published"
  )) {
    if (!capability.hash.digest) {
      findings.push(`${capability.id}: approved or published capability is missing a digest.`);
    }

    const reviewedAt = capability.review.reviewedAt ? new Date(capability.review.reviewedAt) : null;
    if (activeCapabilityIds.has(capability.id) && reviewedAt && Number.isFinite(reviewedAt.getTime())) {
      const ageMs = Date.now() - reviewedAt.getTime();
      const maxAgeMs = options.staleDays * 24 * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) {
        findings.push(`${capability.id}: review is stale (${capability.review.reviewedAt}).`);
      }
    }

    if (options.checkUpstream) {
      const drift = await checkUpstreamDrift(capability);
      if (drift) {
        findings.push(drift);
      }
    }

    findings.push(...(await validateCopyInstallAsset(root, capability)));
  }

  for (const capability of repo.capabilities.filter(
    (item) => item.lifecycleState === "deprecated" && item.install.sourcePath
  )) {
    const sourcePath = capability.install.sourcePath!;
    if (sourcePath.startsWith("assets/")) {
      findings.push(
        `${capability.id}: deprecated payload remains under the active assets tree (${sourcePath}).`
      );
    } else if (!(await pathExists(path.resolve(root, sourcePath)))) {
      findings.push(`${capability.id}: archived deprecated payload is missing (${sourcePath}).`);
    }
  }

  findings.push(...[...repo.runtimes.values()].flatMap((runtime) => validateRuntimeConfig(repo, runtime)));
  findings.push(...validateProfiles(repo));
  findings.push(...[...repo.machines.values()].flatMap((machine) => validateMachineConfig(repo, machine)));

  return findings;
}

export async function buildCapabilityReport(capability: CapabilityRecord, repo: RepoState) {
  const approvalErrors = validateCapabilityForApproval(repo, capability);
  const publishErrors = [
    ...validateCapabilityForPublish(repo, capability),
    ...(await validateCopyInstallAsset(repo.root, capability)),
  ];
  return {
    capabilityId: capability.id,
    lifecycleState: capability.lifecycleState,
    approvalReady: approvalErrors.length === 0,
    publishReady: publishErrors.length === 0,
    approvalErrors,
    publishErrors,
    digest: capability.hash.digest ?? null,
  };
}

export async function loadBootstrap(bootstrapPath: string) {
  return bootstrapSchema.parse(await readYamlFile(bootstrapPath));
}

// Publish and render helpers.
function buildResolutionLock(publishedCapabilities: CapabilityRecord[]): ResolutionLock {
  const generatedAt = deriveDeterministicTimestamp(publishedCapabilities);
  return resolutionLockSchema.parse({
    version: 3,
    generatedAt,
    capabilities: publishedCapabilities
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        assetKind: capability.assetKind,
        riskTier: capability.riskTier,
        bindings: capability.bindings,
        includes: [...capability.includes].sort(),
        ...(capability.entrypoints ? { entrypoints: capability.entrypoints } : {}),
        exposes: [...capability.exposes].sort(),
        canonicalSource: capability.canonicalSource,
        install: capability.install,
        hash: capability.hash,
        activation: capability.activation,
        tags: [...capability.tags].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

async function rebuildSharedCache(
  root: string,
  lock: AnyResolutionLock,
  repo: RepoState,
  machine: MachineRecord
) {
  const sharedCacheRoot = path.join(root, "generated", "shared-cache");
  await removePath(sharedCacheRoot);
  await ensureDir(path.join(sharedCacheRoot, "skills"));
  await ensureDir(path.join(sharedCacheRoot, "packages"));
  await ensureDir(path.join(sharedCacheRoot, "manifests"));

  const claimedPaths = new Map<string, string>();
  const enabledCapabilityIds = getMachineEnabledCapabilityIds(repo, machine);

  for (const capability of lock.capabilities) {
    if (!capability.install.sourcePath) {
      continue;
    }
    if (capability.assetKind !== "skill") {
      continue;
    }
    if (!enabledCapabilityIds.has(capability.id)) {
      continue;
    }

    const relativePath = path.join("skills", capability.install.artifactName);
    const existing = claimedPaths.get(relativePath);
    if (existing && existing !== capability.id) {
      throw new Error(`Artifact cache collision: ${existing} and ${capability.id} both map to ${relativePath}.`);
    }
    claimedPaths.set(relativePath, capability.id);

    const sourcePath = resolveAssetPath(root, capability.install.sourcePath);
    const targetPath = path.join(sharedCacheRoot, relativePath);
    await copyDirectory(sourcePath, targetPath);
  }

  for (const pkg of collectSharedCachePackages(lock, repo, machine)) {
    if (!pkg.sourcePath) {
      continue;
    }

    const relativePath = path.join("packages", pkg.artifactName);
    const existing = claimedPaths.get(relativePath);
    if (existing && existing !== pkg.id) {
      throw new Error(
        `Artifact cache collision: ${existing} and ${pkg.id} both map to ${relativePath}.`
      );
    }
    claimedPaths.set(relativePath, pkg.id);

    const sourcePath = resolveAssetPath(root, pkg.sourcePath);
    const targetPath = path.join(sharedCacheRoot, relativePath);
    await copyDirectory(sourcePath, targetPath);
  }
}

async function buildSharedCacheManifest(
  root: string,
  lock: AnyResolutionLock,
  repo: RepoState,
  machine: MachineRecord
) {
  const manifest: SharedCacheManifest = {
    generatedAt: lock.generatedAt,
    skills: [],
    packages: [],
  };
  const enabledCapabilityIds = getMachineEnabledCapabilityIds(repo, machine);

  for (const capability of lock.capabilities) {
    if (!capability.install.sourcePath) {
      continue;
    }

    if (capability.assetKind === "skill") {
      if (!enabledCapabilityIds.has(capability.id)) {
        continue;
      }
      manifest.skills.push({
        id: capability.id,
        artifactName: capability.install.artifactName,
        sourcePath: capability.install.sourcePath,
        relativePath: path.join("skills", capability.install.artifactName),
      });
      continue;
    }

  }

  for (const pkg of collectSharedCachePackages(lock, repo, machine)) {
    manifest.packages.push({
      id: pkg.id,
      runtimeId: pkg.runtimeId,
      bindingId: pkg.bindingId,
      artifactName: pkg.artifactName,
      sourcePath: pkg.sourcePath,
      relativePath: path.join("packages", pkg.artifactName),
    });
  }

  manifest.skills.sort((left, right) => left.id.localeCompare(right.id));
  manifest.packages.sort((left, right) => left.id.localeCompare(right.id));

  const parsed = sharedCacheManifestSchema.parse(manifest);
  await writeJsonFile(
    path.join(root, "generated", "shared-cache", "manifests", "shared-cache-manifest.json"),
    parsed
  );
  return parsed;
}

async function pruneGeneratedRoot(root: string) {
  const generatedRoot = path.join(root, "generated");
  await ensureDir(generatedRoot);

  const allowedEntries = new Set(["README.md", "machines", "shared-cache"]);
  const entries = await listTopLevelEntries(generatedRoot);
  for (const entry of entries) {
    if (allowedEntries.has(entry.name)) {
      continue;
    }
    await removePath(entry.path);
  }
}

function buildRenderedRuntimeState(args: {
  runtime: RuntimeRecord;
  repo: RepoState;
  machine: MachineRecord;
  bootstrap: BootstrapRecord;
  lock: AnyResolutionLock;
  vars: Record<string, string>;
  projectScope?: string;
}) {
  const machineTarget = args.machine.runtimeTargets[args.runtime.runtimeId];
  const nativeFiles = Object.fromEntries(
    args.runtime.nativeFiles.map((binding) => [
      binding.name,
      renderTemplate(machineTarget?.nativeFiles?.[binding.name] ?? binding.template, args.vars),
    ])
  );
  const cacheBindings = Object.fromEntries(
    args.runtime.cacheBindings.map((binding) => [
      binding.name,
      renderTemplate(machineTarget?.cacheBindings?.[binding.name] ?? binding.template, args.vars),
    ])
  );

  if (args.projectScope) {
    nativeFiles.config = path.join(args.projectScope, ".codex", "config.toml");
    delete nativeFiles.globalAgents;
    delete nativeFiles.userSkillsDir;
  }

  const baseState = {
    machineId: args.machine.machineId,
    runtimeId: args.runtime.runtimeId,
    generatedAt: args.lock.generatedAt,
    profileMode: args.runtime.profileMode,
    nativeFiles,
    cacheBindings,
    ownedStateFile: args.projectScope
      ? projectOwnedStateFile(args.runtime.runtimeId, args.projectScope, args.vars)
      : renderTemplate(args.runtime.ownedStateFile, args.vars),
    skills: [] as RenderedRuntimeState["skills"],
    plugins: [] as RenderedRuntimeState["plugins"],
    mcps: [] as RenderedRuntimeState["mcps"],
  };

  if (isLegacyResolutionLock(args.lock)) {
    populateRenderedRuntimeStateFromLegacy(baseState, args.runtime.runtimeId, args.lock, args.vars);
  } else {
    populateRenderedRuntimeStateFromBindings(
      baseState,
      args.repo,
      args.machine,
      args.runtime,
      args.lock,
      args.vars,
      args.projectScope
    );
  }

  baseState.skills.sort((left, right) => left.id.localeCompare(right.id));
  baseState.plugins.sort((left, right) => left.id.localeCompare(right.id));
  baseState.mcps.sort((left, right) => left.id.localeCompare(right.id));

  return baseState;
}

function hasManagedRuntimeEntries(state: RenderedRuntimeState) {
  return state.skills.length > 0 || state.plugins.length > 0 || state.mcps.length > 0;
}

function projectOwnedStateFile(runtimeId: string, projectScope: string, vars: Record<string, string>) {
  const digest = createHash("sha256").update(path.resolve(projectScope)).digest("hex").slice(0, 16);
  return path.join(
    vars.HOME!,
    ".config",
    "agent-governance",
    "state",
    vars.MACHINE_ID!,
    `${runtimeId}-projects`,
    `${digest}.json`
  );
}

function projectRuntimeIndexFile(runtimeId: string, vars: Record<string, string>) {
  return path.join(
    vars.HOME!,
    ".config",
    "agent-governance",
    "state",
    vars.MACHINE_ID!,
    `${runtimeId}-projects.json`
  );
}

function populateRenderedRuntimeStateFromBindings(
  baseState: RenderedRuntimeState,
  repo: RepoState,
  machine: MachineRecord,
  runtime: RuntimeRecord,
  lock: ResolutionLock,
  vars: Record<string, string>,
  projectScope?: string
) {
  const enabledCapabilities = getEffectiveEnabledCapabilityIds(repo, runtime, machine, projectScope);

  for (const capability of lock.capabilities) {
    if (!enabledCapabilities.has(capability.id)) {
      continue;
    }
    if (!runtime.supportedAssetKinds.includes(capability.assetKind)) {
      continue;
    }

    const selectedBinding = resolveBindingForRuntime(runtime, capability, Boolean(projectScope));
    if (!selectedBinding) {
      continue;
    }

    if (selectedBinding.binding.skill) {
      baseState.skills.push({
        id: capability.id,
        bindingId: selectedBinding.bindingId,
        artifactName: capability.install.artifactName,
        cacheRelativePath: path.join("skills", capability.install.artifactName),
        syncMode: projectScope ? "config-path" : selectedBinding.binding.skill.syncMode,
      });
      continue;
    }

    if (selectedBinding.binding.mcp) {
      baseState.mcps.push({
        id: capability.id,
        bindingId: selectedBinding.bindingId,
        serverName: selectedBinding.binding.mcp.serverName,
        adoptExisting: selectedBinding.binding.mcp.adoptExisting,
        config: resolveTemplates(
          selectedBinding.binding.mcp.config,
          vars,
          {},
          false
        ) as Record<string, unknown>,
      });
      continue;
    }

    if (selectedBinding.binding.plugin) {
      baseState.plugins.push({
        id: capability.id,
        bindingId: selectedBinding.bindingId,
        artifactName: selectedBinding.binding.plugin.install.artifactName,
        ...(selectedBinding.binding.plugin.install.sourcePath
          ? {
              cacheRelativePath: path.join(
                "packages",
                selectedBinding.binding.plugin.install.artifactName
              ),
            }
          : {}),
        nativeRegistration: resolveTemplates(
          selectedBinding.binding.plugin.nativeRegistration,
          vars,
          {},
          false
        ) as RenderedRuntimeState["plugins"][number]["nativeRegistration"],
      });
    }
  }
}

function populateRenderedRuntimeStateFromLegacy(
  baseState: RenderedRuntimeState,
  runtimeId: string,
  lock: LegacyResolutionLock,
  vars: Record<string, string>
) {
  for (const capability of lock.capabilities) {
    if (!capability.runtimeTargets.includes(runtimeId)) {
      continue;
    }
    const binding = capability.runtimeBindings[runtimeId];
    if (!binding) {
      continue;
    }

    if (binding.skill) {
      baseState.skills.push({
        id: capability.id,
        bindingId: binding.skill.syncMode === "user-skill-dir" ? "user-dir" : "cache",
        artifactName: capability.install.artifactName,
        cacheRelativePath: path.join("skills", capability.install.artifactName),
        syncMode: binding.skill.syncMode,
      });
    }

    if (binding.mcp) {
      baseState.mcps.push({
        id: capability.id,
        bindingId: binding.mcp.config.url ? "remote-http" : "stdio-command",
        serverName: binding.mcp.serverName,
        adoptExisting: binding.mcp.adoptExisting,
        config: resolveTemplates(binding.mcp.config, vars, {}, false) as Record<string, unknown>,
      });
    }
  }

  for (const distribution of lock.distributions) {
    if (distribution.runtimeId !== runtimeId) {
      continue;
    }

    baseState.plugins.push({
      id: distribution.pluginId,
      bindingId: "legacy-runtime-distribution",
      artifactName: distribution.install.artifactName,
      ...(distribution.install.sourcePath
        ? { cacheRelativePath: path.join("packages", distribution.install.artifactName) }
        : {}),
      nativeRegistration: resolveTemplates(
        distribution.nativeRegistration,
        vars,
        {},
        false
      ) as RenderedRuntimeState["plugins"][number]["nativeRegistration"],
    });
  }
}

function collectSharedCachePackages(
  lock: AnyResolutionLock,
  repo: RepoState,
  machine: MachineRecord
) {
  if (isLegacyResolutionLock(lock)) {
    return lock.distributions
      .filter((distribution) => Boolean(distribution.install.sourcePath))
      .map((distribution) => ({
        id: distribution.pluginId,
        runtimeId: distribution.runtimeId,
        bindingId: "legacy-runtime-distribution",
        artifactName: distribution.install.artifactName,
        sourcePath: distribution.install.sourcePath!,
      }));
  }

  const packages: Array<{
    id: string;
    runtimeId: string;
    bindingId: string;
    artifactName: string;
    sourcePath: string;
  }> = [];

  for (const runtimeId of machine.enabledRuntimes) {
    const runtime = repo.runtimes.get(runtimeId);
    if (!runtime) {
      continue;
    }

    const enabledCapabilities = getEffectiveEnabledCapabilityIds(repo, runtime, machine);
    for (const capability of lock.capabilities) {
      if (capability.assetKind !== "plugin") {
        continue;
      }
      if (!enabledCapabilities.has(capability.id)) {
        continue;
      }

      const selectedBinding = resolveBindingForRuntime(runtime, capability);
      const install = selectedBinding?.binding.plugin?.install;
      if (!selectedBinding || !install?.sourcePath) {
        continue;
      }

      packages.push({
        id: capability.id,
        runtimeId,
        bindingId: selectedBinding.bindingId,
        artifactName: install.artifactName,
        sourcePath: install.sourcePath,
      });
    }
  }

  return packages;
}

function getMachineEnabledCapabilityIds(repo: RepoState, machine: MachineRecord) {
  const enabled = new Set<string>();
  for (const runtimeId of machine.enabledRuntimes) {
    const runtime = repo.runtimes.get(runtimeId);
    if (!runtime) {
      continue;
    }
    for (const capabilityId of getEffectiveEnabledCapabilityIds(repo, runtime, machine)) {
      enabled.add(capabilityId);
    }
    for (const projectScope of getActiveProjectScopes(repo, runtime, machine)) {
      for (const capabilityId of getEffectiveEnabledCapabilityIds(repo, runtime, machine, projectScope)) {
        enabled.add(capabilityId);
      }
    }
  }
  return enabled;
}

function getEffectiveEnabledCapabilityIds(
  repo: RepoState,
  runtime: RuntimeRecord,
  machine: MachineRecord,
  projectScope?: string
) {
  const enabled = new Set(projectScope ? [] : runtime.enabledCapabilities);
  const blocked = new Set<string>();

  for (const profileId of machine.activeProfiles) {
    const profile = repo.profiles.get(profileId);
    if (!profile || profile.runtimeId !== runtime.runtimeId) {
      continue;
    }
    if (projectScope) {
      if (!profile.projectScopes.some((scope) => pathIsWithinOrEqual(projectScope, scope))) {
        continue;
      }
    } else if (profile.projectScopes.length > 0) {
      continue;
    }
    for (const capabilityId of profile.enabledCapabilities) {
      enabled.add(capabilityId);
    }
    for (const capabilityId of profile.blockedCapabilities) {
      blocked.add(capabilityId);
    }
  }

  for (const capabilityId of blocked) {
    enabled.delete(capabilityId);
  }

  return enabled;
}

function getActiveProjectScopes(repo: RepoState, runtime: RuntimeRecord, machine: MachineRecord) {
  const scopes = new Set<string>();
  for (const profileId of machine.activeProfiles) {
    const profile = repo.profiles.get(profileId);
    if (!profile || profile.runtimeId !== runtime.runtimeId) {
      continue;
    }
    for (const projectScope of profile.projectScopes) {
      scopes.add(path.resolve(projectScope));
    }
  }
  return [...scopes].sort();
}

function resolveBindingForRuntime(
  runtime: RuntimeRecord,
  capability: ResolutionLock["capabilities"][number],
  preferProjectBinding = false
) {
  const policyKey = bindingPolicyKeyForAssetKind(capability.assetKind);
  if (!policyKey) {
    return null;
  }

  const override = runtime.bindingPolicy.overrides[capability.id];
  if (override === "disabled") {
    return null;
  }

  const candidateBindingIds = override
    ? [override]
    : preferProjectBinding && policyKey === "skill" && capability.bindings["user-dir"]
      ? ["user-dir", ...runtime.bindingPolicy.defaults[policyKey].filter((id) => id !== "user-dir")]
      : runtime.bindingPolicy.defaults[policyKey];

  for (const bindingId of candidateBindingIds) {
    const binding = capability.bindings[bindingId];
    if (binding && capabilityBindingMatchesAssetKind(capability.assetKind, binding)) {
      return { bindingId, binding };
    }
  }

  return null;
}

function bindingPolicyKeyForAssetKind(assetKind: CapabilityRecord["assetKind"]) {
  switch (assetKind) {
    case "skill":
    case "mcp":
    case "plugin":
      return assetKind;
    default:
      return null;
  }
}

function capabilityBindingMatchesAssetKind(
  assetKind: CapabilityRecord["assetKind"],
  binding: ResolutionLock["capabilities"][number]["bindings"][string]
) {
  switch (assetKind) {
    case "skill":
      return Boolean(binding.skill) && !binding.plugin && !binding.mcp;
    case "mcp":
      return Boolean(binding.mcp) && !binding.plugin && !binding.skill;
    case "plugin":
      return Boolean(binding.plugin) && !binding.mcp && !binding.skill;
    default:
      return false;
  }
}

function isLegacyResolutionLock(lock: AnyResolutionLock): lock is LegacyResolutionLock {
  return lock.version === 2;
}

function buildPathVars(bootstrap: BootstrapRecord, machine: MachineRecord) {
  return {
    HOME: process.env.HOME ?? os.homedir(),
    WORKSPACE_ROOT: machine.workspaceRoot,
    MACHINE_ID: machine.machineId,
    CACHE_ROOT: bootstrap.cacheRoot,
    ...machine.pathVars,
  };
}

function getDefaultBootstrapPath() {
  return path.join(
    process.env.HOME ?? os.homedir(),
    ".config",
    "agent-governance",
    "bootstrap.yaml"
  );
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Unknown template variable ${key} in ${template}.`);
    }
    return vars[key]!;
  });
}

function resolveTemplates(
  value: unknown,
  vars: Record<string, string>,
  secrets: Record<string, string>,
  strictSecrets: boolean
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, vars, secrets, strictSecrets));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [
        key,
        resolveTemplates(innerValue, vars, secrets, strictSecrets),
      ])
    );
  }

  if (typeof value === "string") {
    return value
      .replace(/\$\{([A-Z0-9_]+)\}/g, (match, key: string) => {
        return key in vars ? vars[key]! : match;
      })
      .replace(/\$\{SECRET:([A-Z0-9_:-]+)\}/g, (match, key: string) => {
        if (key in secrets) {
          return secrets[key]!;
        }
        if (strictSecrets) {
          throw new Error(`Missing required secret ${key}.`);
        }
        return match;
      });
  }

  return value;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  if (!base || typeof base !== "object" || Array.isArray(base)) {
    return override;
  }

  const merged = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

// Validation and lookup helpers.
function validateCapabilityForApproval(repo: RepoState, capability: CapabilityRecord) {
  const errors = validateCapabilityBase(repo, capability);
  const requiresReview = capability.riskTier !== "T0";

  if (requiresReview) {
    if (capability.review.status !== "approved") {
      errors.push(`${capability.id}: review.status must be approved before approval.`);
    }
    if (!capability.review.reviewer) {
      errors.push(`${capability.id}: review.reviewer is required.`);
    }
    if (!capability.review.reviewedAt) {
      errors.push(`${capability.id}: review.reviewedAt is required.`);
    }
    if (!capability.review.license) {
      errors.push(`${capability.id}: review.license is required.`);
    }
    for (const field of ["executesScripts", "networkAccess", "touchesCredentials"] as const) {
      if (capability.review[field] === undefined) {
        errors.push(`${capability.id}: review.${field} is required.`);
      }
    }
  }

  if (capability.riskTier === "T2" || capability.riskTier === "T3") {
    if (!capability.hash.digest) {
      errors.push(`${capability.id}: hash.digest is required for ${capability.riskTier}.`);
    }
    if (!capability.canonicalSource.ref || !capability.canonicalSource.path) {
      errors.push(`${capability.id}: canonicalSource ref and path are required.`);
    }
  }

  return errors;
}

function validateCapabilityForPublish(repo: RepoState, capability: CapabilityRecord) {
  const errors = validateCapabilityForApproval(repo, capability);
  if (!capability.hash.digest) {
    errors.push(`${capability.id}: published capabilities must include a digest.`);
  }
  if (capability.install.strategy === "copy" && !capability.install.sourcePath) {
    errors.push(`${capability.id}: copy strategy requires install.sourcePath.`);
  }
  return errors;
}

async function validateCopyInstallAsset(
  root: string,
  record: Pick<CapabilityRecord, "id" | "assetKind" | "install">
) {
  if (record.install.strategy !== "copy") {
    return [];
  }

  const errors: string[] = [];
  if (!record.install.sourcePath) {
    errors.push(`${record.id}: copy strategy requires install.sourcePath.`);
    return errors;
  }

  const assetPath = resolveAssetPath(root, record.install.sourcePath);
  if (!(await pathExists(assetPath))) {
    errors.push(`${record.id}: install.sourcePath does not exist at ${assetPath}.`);
    return errors;
  }

  if ("assetKind" in record && record.assetKind === "skill") {
    const skillEntryPath = path.join(assetPath, "SKILL.md");
    if (!(await pathExists(skillEntryPath))) {
      errors.push(
        `${record.id}: skill assets must include SKILL.md at ${normalizePosix(
          path.join(record.install.sourcePath, "SKILL.md")
        )}.`
      );
    }
  }

  const absoluteSymlinks = await listAbsoluteSymlinks(assetPath);
  for (const symlinkPath of absoluteSymlinks) {
    const relativePath = normalizePosix(path.relative(assetPath, symlinkPath));
    errors.push(
      `${record.id}: copy asset contains absolute symlink ${normalizePosix(
        path.join(record.install.sourcePath, relativePath)
      )}.`
    );
  }

  return errors;
}

function validateCapabilityBase(repo: RepoState, capability: CapabilityRecord) {
  const errors: string[] = [];
  const canonicalSource = repo.sources.get(capability.canonicalSource.sourceId);
  if (!canonicalSource) {
    errors.push(
      `${capability.id}: unknown canonicalSource.sourceId ${capability.canonicalSource.sourceId}.`
    );
  } else if (canonicalSource.discoveryOnly) {
    errors.push(`${capability.id}: canonical source ${canonicalSource.id} cannot be discovery-only.`);
  }

  for (const sourceId of capability.discoverySources) {
    const source = repo.sources.get(sourceId);
    if (!source) {
      errors.push(`${capability.id}: unknown discovery source ${sourceId}.`);
      continue;
    }
    if (!source.discoveryOnly) {
      errors.push(`${capability.id}: discovery source ${sourceId} must be marked discoveryOnly.`);
    }
  }

  if (capability.assetKind !== capability.id.split(".")[0]) {
    errors.push(`${capability.id}: id prefix must match assetKind.`);
  }

  errors.push(...validateCapabilityBindings(capability));

  if (capability.assetKind === "plugin") {
    const supportedKinds = new Set(["skill", "mcp", "command", "agent"]);
    for (const includedId of capability.includes) {
      const included = repo.capabilities.find((item) => item.id === includedId);
      if (!included) {
        errors.push(`${capability.id}: includes references unknown capability ${includedId}.`);
        continue;
      }
      if (!supportedKinds.has(included.assetKind)) {
        errors.push(`${capability.id}: includes cannot reference ${included.assetKind} capability ${includedId}.`);
      }
    }

    for (const commandId of capability.entrypoints?.commands ?? []) {
      const command = repo.capabilities.find((item) => item.id === commandId);
      if (!command) {
        errors.push(`${capability.id}: entrypoints.commands references unknown capability ${commandId}.`);
      } else if (command.assetKind !== "command") {
        errors.push(`${capability.id}: entrypoints.commands must reference command capabilities (${commandId}).`);
      }
    }

    for (const agentId of capability.entrypoints?.agents ?? []) {
      const agent = repo.capabilities.find((item) => item.id === agentId);
      if (!agent) {
        errors.push(`${capability.id}: entrypoints.agents references unknown capability ${agentId}.`);
      } else if (agent.assetKind !== "agent") {
        errors.push(`${capability.id}: entrypoints.agents must reference agent capabilities (${agentId}).`);
      }
    }
  }

  return errors;
}

function validateCapabilityBindings(capability: CapabilityRecord) {
  const errors: string[] = [];
  const allowedBindingIds = new Set<string>(
    capability.assetKind === "skill"
      ? ["cache", "user-dir"]
      : capability.assetKind === "mcp"
        ? ["remote-http", "stdio-command"]
        : capability.assetKind === "plugin"
          ? ["package", "marketplace", "external"]
          : []
  );

  for (const [bindingId, binding] of Object.entries(capability.bindings)) {
    if (!allowedBindingIds.has(bindingId)) {
      errors.push(`${capability.id}: binding ${bindingId} is not allowed for ${capability.assetKind}.`);
    }

    const activeFieldCount = Number(Boolean(binding.skill)) + Number(Boolean(binding.mcp)) + Number(Boolean(binding.plugin));
    if (activeFieldCount !== 1) {
      errors.push(`${capability.id}: binding ${bindingId} must define exactly one binding payload.`);
      continue;
    }

    if (!capabilityBindingMatchesAssetKind(capability.assetKind, binding)) {
      errors.push(`${capability.id}: binding ${bindingId} must match assetKind ${capability.assetKind}.`);
    }
  }

  if ((capability.assetKind === "command" || capability.assetKind === "agent") && Object.keys(capability.bindings).length > 0) {
    errors.push(`${capability.id}: ${capability.assetKind} capabilities cannot define bindings.`);
  }

  return errors;
}

function validateRuntimeConfig(repo: RepoState, runtime: RuntimeRecord) {
  const errors: string[] = [];

  for (const capabilityId of runtime.enabledCapabilities) {
    const capability = repo.capabilities.find((item) => item.id === capabilityId);
    if (!capability) {
      errors.push(`${runtime.runtimeId}: enabledCapabilities references unknown capability ${capabilityId}.`);
      continue;
    }
    if (!runtime.supportedAssetKinds.includes(capability.assetKind)) {
      errors.push(
        `${runtime.runtimeId}: enabled capability ${capabilityId} has unsupported assetKind ${capability.assetKind}.`
      );
    }
    if (capability.activation.projectScopes.length > 0) {
      errors.push(
        `${runtime.runtimeId}: global enabledCapabilities cannot include project-scoped capability ${capabilityId}.`
      );
    }
  }

  for (const [capabilityId, bindingId] of Object.entries(runtime.bindingPolicy.overrides)) {
    if (bindingId === "disabled") {
      continue;
    }

    const capability = repo.capabilities.find((item) => item.id === capabilityId);
    if (!capability) {
      errors.push(`${runtime.runtimeId}: binding override references unknown capability ${capabilityId}.`);
      continue;
    }
    if (!capability.bindings[bindingId]) {
      errors.push(
        `${runtime.runtimeId}: binding override ${capabilityId} -> ${bindingId} references a missing binding.`
      );
    }
  }

  return errors;
}

function validateProfiles(repo: RepoState) {
  const errors: string[] = [];

  for (const profile of repo.profiles.values()) {
    const runtime = repo.runtimes.get(profile.runtimeId);
    if (!runtime) {
      errors.push(`${profile.profileId}: references unknown runtime ${profile.runtimeId}.`);
      continue;
    }

    const profileCapabilities = [
      ...profile.enabledCapabilities.map((id) => ({ id, field: "enabledCapabilities" })),
      ...profile.referenceCapabilities.map((id) => ({ id, field: "referenceCapabilities" })),
      ...profile.blockedCapabilities.map((id) => ({ id, field: "blockedCapabilities" })),
    ];
    for (const projectScope of profile.projectScopes) {
      if (!path.isAbsolute(projectScope)) {
        errors.push(`${profile.profileId}: projectScopes must use absolute paths, got ${projectScope}.`);
      }
    }
    for (const { id, field } of profileCapabilities) {
      const capability = repo.capabilities.find((item) => item.id === id);
      if (!capability) {
        errors.push(`${profile.profileId}: ${field} references unknown capability ${id}.`);
        continue;
      }
      if (field === "enabledCapabilities" && !runtime.supportedAssetKinds.includes(capability.assetKind)) {
        errors.push(
          `${profile.profileId}: enabled capability ${id} has unsupported assetKind ${capability.assetKind} for ${profile.runtimeId}.`
        );
      }
      if (field !== "enabledCapabilities") {
        continue;
      }
      if (profile.projectScopes.length === 0 && capability.activation.projectScopes.length > 0) {
        errors.push(
          `${profile.profileId}: global profile cannot enable project-scoped capability ${id}.`
        );
        continue;
      }
      if (
        profile.projectScopes.length > 0 &&
        capability.activation.projectScopes.length > 0
      ) {
        for (const profileScope of profile.projectScopes) {
          if (
            !capability.activation.projectScopes.some((capabilityScope) =>
              pathIsWithinOrEqual(profileScope, capabilityScope)
            )
          ) {
            errors.push(
              `${profile.profileId}: project scope ${profileScope} is outside ${id} activation scopes.`
            );
          }
        }
      }
    }
  }

  return errors;
}

function pathIsWithinOrEqual(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateMachineConfig(repo: RepoState, machine: MachineRecord) {
  const errors: string[] = [];
  for (const profileId of machine.activeProfiles) {
    if (!repo.profiles.has(profileId)) {
      errors.push(`${machine.machineId}: activeProfiles references unknown profile ${profileId}.`);
    }
  }
  return errors;
}

async function readResolutionLock(lockPath: string) {
  const raw = await readJsonFile<unknown>(lockPath);
  const version = raw && typeof raw === "object" ? (raw as { version?: unknown }).version : undefined;
  if (version === 2) {
    return legacyResolutionLockSchema.parse(raw);
  }
  return resolutionLockSchema.parse(raw);
}

async function loadCapabilityById(root: string, id: string) {
  const filePath = capabilityFilePath(root, id);
  if (!(await pathExists(filePath))) {
    throw new Error(`Unknown capability ${id}.`);
  }

  const capability = capabilitySchema.parse(await readYamlFile(filePath));
  return { capability, filePath };
}

function resolveAssetPath(root: string, sourcePath: string) {
  return path.isAbsolute(sourcePath) ? sourcePath : path.join(root, sourcePath);
}

function registryPathSegmentsFromId(id: string) {
  const segments = id.split(".");
  const [kind, ...rest] = segments;
  if (!kind || rest.length === 0) {
    throw new Error(`Invalid capability id ${id}.`);
  }
  return [kind, ...rest.slice(0, -1), `${rest.at(-1)}.yaml`];
}

function inferPermissions(riskTier: CapabilityRecord["riskTier"]): CapabilityRecord["permissions"] {
  switch (riskTier) {
    case "T0":
      return { localRead: "none", network: false, credentials: false, filesystemWrite: "none" };
    case "T1":
      return { localRead: "scoped", network: false, credentials: false, filesystemWrite: "none" };
    case "T2":
      return {
        localRead: "scoped",
        network: true,
        credentials: false,
        filesystemWrite: "runtime-only",
      };
    case "T3":
      return { localRead: "full", network: true, credentials: true, filesystemWrite: "full" };
  }
}

function defaultBindingsForAssetKind(assetKind: CapabilityRecord["assetKind"]) {
  switch (assetKind) {
    case "skill":
      return {
        cache: {
          skill: {
            syncMode: "cache-only" as const,
          },
        },
        "user-dir": {
          skill: {
            syncMode: "user-skill-dir" as const,
          },
        },
      };
    default:
      return {};
  }
}

async function enableCapabilityForRuntimes(root: string, capabilityId: string, runtimeIds: string[]) {
  for (const runtimeId of [...new Set(runtimeIds)].sort()) {
    const runtimePath = path.join(root, "runtimes", `${runtimeId}.yaml`);
    if (!(await pathExists(runtimePath))) {
      throw new Error(`Unknown runtime ${runtimeId}.`);
    }

    const runtime = runtimeSchema.parse(await readYamlFile(runtimePath));
    if (!runtime.enabledCapabilities.includes(capabilityId)) {
      runtime.enabledCapabilities = [...runtime.enabledCapabilities, capabilityId].sort();
      await writeYamlFile(runtimePath, runtime);
    }
  }
}

function deriveDeterministicTimestamp(capabilities: Array<Pick<CapabilityRecord, "review">>) {
  const values = capabilities
    .map((record) => record.review.reviewedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  return values.at(-1)?.toISOString() ?? null;
}

async function checkUpstreamDrift(capability: CapabilityRecord) {
  const { refType, ref, url, resolvedRevision } = capability.canonicalSource;
  if (!resolvedRevision) {
    return `${capability.id}: canonicalSource.resolvedRevision is missing; upstream drift cannot be checked.`;
  }

  if (refType === "commit") {
    return null;
  }

  const refSpec = refType === "branch" ? `refs/heads/${ref}` : `refs/tags/${ref}`;
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", url, refSpec], {
      timeout: 10000,
    });
    const latest = stdout.trim().split(/\s+/)[0];
    if (!latest) {
      return `${capability.id}: unable to resolve upstream ref ${refSpec}.`;
    }
    if (latest !== resolvedRevision) {
      return `${capability.id}: upstream ref ${refSpec} moved from ${resolvedRevision} to ${latest}.`;
    }
    return null;
  } catch (error) {
    return `${capability.id}: upstream check failed (${String(error)}).`;
  }
}

async function loadLocalSecrets(localSecretsPath: string) {
  if (!(await pathExists(localSecretsPath))) {
    return localSecretsSchema.parse({});
  }
  return localSecretsSchema.parse(await readYamlFile<LocalSecretsRecord>(localSecretsPath));
}

function getMachineOrThrow(repo: RepoState, machineId: string) {
  const machine = repo.machines.get(machineId);
  if (!machine) {
    throw new Error(`Unknown machine ${machineId}.`);
  }
  return machine;
}

function withDefinedValues<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, innerValue]) => innerValue !== undefined)
  ) as T;
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
