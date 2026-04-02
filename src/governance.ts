import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  BootstrapRecord,
  CapabilityRecord,
  LocalSecretsRecord,
  MachineRecord,
  RenderedRuntimeState,
  ResolutionLock,
  RuntimeRecord,
  SharedCacheManifest,
  SourceRecord,
} from "./schema.js";
import {
  bootstrapSchema,
  capabilitySchema,
  localSecretsSchema,
  machineSchema,
  renderedRuntimeStateSchema,
  resolutionLockSchema,
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
  syncCodexRuntime,
  syncCursorRuntime,
  syncSharedArtifactCache,
} from "./runtime-adapters.js";

const execFileAsync = promisify(execFile);
const CACHE_STATE_FILE = ".agent-governance-cache-state.json";

type RepoState = {
  root: string;
  sources: Map<string, SourceRecord>;
  capabilities: CapabilityRecord[];
  runtimes: Map<string, RuntimeRecord>;
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
  const machineFiles = await listFiles(path.join(root, "machines"), ".yaml");

  const capabilities = await Promise.all(
    capabilityFiles.map(async (filePath) => capabilitySchema.parse(await readYamlFile(filePath)))
  );
  const runtimes = await Promise.all(
    runtimeFiles.map(async (filePath) => runtimeSchema.parse(await readYamlFile(filePath)))
  );
  const machines = await Promise.all(
    machineFiles.map(async (filePath) => machineSchema.parse(await readYamlFile(filePath)))
  );

  return {
    root,
    sources: new Map(parsedSources.sources.map((record) => [record.id, record])),
    capabilities: capabilities.sort((left, right) => left.id.localeCompare(right.id)),
    runtimes: new Map(runtimes.map((record) => [record.runtimeId, record])),
    machines: new Map(machines.map((record) => [record.machineId, record])),
  };
}

export function capabilityFilePath(root: string, id: string) {
  return path.join(root, "registry", "capabilities", `${id}.yaml`);
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

  const runtimeBindings = Object.fromEntries(
    input.runtimeTargets.map((runtimeId) => [
      runtimeId,
      input.assetKind === "skill"
        ? {
            skill: {
              syncMode: runtimeId === "cursor" ? "user-skill-dir" : "cache-only",
            },
          }
        : {},
    ])
  );

  const capability = capabilitySchema.parse({
    id: input.id,
    name: input.name,
    assetKind: input.assetKind,
    runtimeTargets: input.runtimeTargets,
    runtimeBindings,
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
  const publishable = repo.capabilities.filter(
    (capability) =>
      capability.lifecycleState === "approved" || capability.lifecycleState === "published"
  );

  const publishErrors = publishable.flatMap((capability) =>
    validateCapabilityForPublish(repo, capability)
  );
  if (publishErrors.length > 0) {
    throw new Error(publishErrors.join("\n"));
  }

  const assetErrors = (
    await Promise.all(publishable.map((capability) => validateCopyInstallAsset(root, capability)))
  ).flat();
  if (assetErrors.length > 0) {
    throw new Error(assetErrors.join("\n"));
  }

  for (const capability of publishable) {
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
  const published = refreshedRepo.capabilities.filter(
    (capability) => capability.lifecycleState === "published"
  );
  const lock = buildResolutionLock(published);
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

  await rebuildSharedCache(options.root, lock);
  const sharedCacheManifest = await buildSharedCacheManifest(options.root, lock);

  const generatedMachineRoot = path.join(options.root, "generated", "machines", machine.machineId);
  await removePath(generatedMachineRoot);
  await ensureDir(generatedMachineRoot);

  const vars = buildPathVars(options.bootstrap, machine);
  const renderedStates: RenderedRuntimeState[] = [];

  for (const runtimeId of machine.enabledRuntimes) {
    const runtime = repo.runtimes.get(runtimeId);
    if (!runtime) {
      throw new Error(`Machine ${machine.machineId} references unknown runtime ${runtimeId}.`);
    }

    const rendered = renderedRuntimeStateSchema.parse(
      deepMerge(
        buildRenderedRuntimeState({
          runtime,
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
  }

  return {
    lock,
    sharedCacheManifest,
    renderedStates,
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
      await syncCodexRuntime(resolvedState);
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

export async function auditGovernance(root: string, options: AuditOptions) {
  const repo = await loadRepo(root);
  const published = repo.capabilities.filter((capability) => capability.lifecycleState === "published");
  const generatedLock = buildResolutionLock(published);
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
    if (reviewedAt && Number.isFinite(reviewedAt.getTime())) {
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

function buildResolutionLock(published: CapabilityRecord[]): ResolutionLock {
  const generatedAt = deriveDeterministicTimestamp(published);
  return resolutionLockSchema.parse({
    version: 2,
    generatedAt,
    capabilities: published
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        assetKind: capability.assetKind,
        riskTier: capability.riskTier,
        runtimeTargets: [...capability.runtimeTargets].sort(),
        runtimeBindings: capability.runtimeBindings,
        canonicalSource: capability.canonicalSource,
        install: capability.install,
        hash: capability.hash,
        tags: [...capability.tags].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

async function rebuildSharedCache(root: string, lock: ResolutionLock) {
  const sharedCacheRoot = path.join(root, "generated", "shared-cache");
  await removePath(sharedCacheRoot);
  await ensureDir(path.join(sharedCacheRoot, "skills"));
  await ensureDir(path.join(sharedCacheRoot, "packages"));
  await ensureDir(path.join(sharedCacheRoot, "manifests"));

  const claimedPaths = new Map<string, string>();

  for (const capability of lock.capabilities) {
    if (!capability.install.sourcePath) {
      continue;
    }

    const category =
      capability.assetKind === "skill"
        ? "skills"
        : capability.assetKind === "plugin"
          ? "packages"
          : null;

    if (!category) {
      continue;
    }

    const relativePath = path.join(category, capability.install.artifactName);
    const existing = claimedPaths.get(relativePath);
    if (existing && existing !== capability.id) {
      throw new Error(`Artifact cache collision: ${existing} and ${capability.id} both map to ${relativePath}.`);
    }
    claimedPaths.set(relativePath, capability.id);

    const sourcePath = resolveAssetPath(root, capability.install.sourcePath);
    const targetPath = path.join(sharedCacheRoot, relativePath);
    await copyDirectory(sourcePath, targetPath);
  }
}

async function buildSharedCacheManifest(root: string, lock: ResolutionLock) {
  const manifest: SharedCacheManifest = {
    generatedAt: lock.generatedAt,
    skills: [],
    packages: [],
  };

  for (const capability of lock.capabilities) {
    if (!capability.install.sourcePath) {
      continue;
    }

    if (capability.assetKind === "skill") {
      manifest.skills.push({
        id: capability.id,
        artifactName: capability.install.artifactName,
        sourcePath: capability.install.sourcePath,
        relativePath: path.join("skills", capability.install.artifactName),
      });
      continue;
    }

    if (capability.assetKind === "plugin") {
      manifest.packages.push({
        id: capability.id,
        artifactName: capability.install.artifactName,
        sourcePath: capability.install.sourcePath,
        relativePath: path.join("packages", capability.install.artifactName),
      });
    }
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
  machine: MachineRecord;
  bootstrap: BootstrapRecord;
  lock: ResolutionLock;
  vars: Record<string, string>;
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

  const baseState = {
    machineId: args.machine.machineId,
    runtimeId: args.runtime.runtimeId,
    generatedAt: args.lock.generatedAt,
    profileMode: args.runtime.profileMode,
    nativeFiles,
    cacheBindings,
    ownedStateFile: renderTemplate(args.runtime.ownedStateFile, args.vars),
    skills: [] as RenderedRuntimeState["skills"],
    plugins: [] as RenderedRuntimeState["plugins"],
    mcps: [] as RenderedRuntimeState["mcps"],
  };

  for (const capability of args.lock.capabilities) {
    if (!capability.runtimeTargets.includes(args.runtime.runtimeId)) {
      continue;
    }
    const binding = capability.runtimeBindings[args.runtime.runtimeId];
    if (!binding) {
      continue;
    }

    if (binding.skill) {
      baseState.skills.push({
        id: capability.id,
        artifactName: capability.install.artifactName,
        cacheRelativePath: path.join("skills", capability.install.artifactName),
        syncMode: binding.skill.syncMode,
      });
    }

    if (binding.plugin) {
      baseState.plugins.push({
        id: capability.id,
        pluginId: binding.plugin.pluginId,
        enabled: binding.plugin.enabled,
        ...(binding.plugin.knownMarketplace
          ? {
              knownMarketplace: resolveTemplates(binding.plugin.knownMarketplace, args.vars, {}, false) as Record<
                string,
                unknown
              >,
            }
          : {}),
        installedRecords: resolveTemplates(binding.plugin.installedRecords, args.vars, {}, false) as Array<
          Record<string, unknown>
        >,
      });
    }

    if (binding.mcp) {
      baseState.mcps.push({
        id: capability.id,
        serverName: binding.mcp.serverName,
        config: resolveTemplates(binding.mcp.config, args.vars, {}, false) as Record<string, unknown>,
      });
    }
  }

  baseState.skills.sort((left, right) => left.id.localeCompare(right.id));
  baseState.plugins.sort((left, right) => left.id.localeCompare(right.id));
  baseState.mcps.sort((left, right) => left.id.localeCompare(right.id));

  return baseState;
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

async function validateCopyInstallAsset(root: string, capability: CapabilityRecord) {
  if (capability.install.strategy !== "copy") {
    return [];
  }

  const errors: string[] = [];
  if (!capability.install.sourcePath) {
    errors.push(`${capability.id}: copy strategy requires install.sourcePath.`);
    return errors;
  }

  const assetPath = resolveAssetPath(root, capability.install.sourcePath);
  if (!(await pathExists(assetPath))) {
    errors.push(`${capability.id}: install.sourcePath does not exist at ${assetPath}.`);
    return errors;
  }

  if (capability.assetKind === "skill") {
    const skillEntryPath = path.join(assetPath, "SKILL.md");
    if (!(await pathExists(skillEntryPath))) {
      errors.push(
        `${capability.id}: skill assets must include SKILL.md at ${normalizePosix(
          path.join(capability.install.sourcePath, "SKILL.md")
        )}.`
      );
    }
  }

  const absoluteSymlinks = await listAbsoluteSymlinks(assetPath);
  for (const symlinkPath of absoluteSymlinks) {
    const relativePath = normalizePosix(path.relative(assetPath, symlinkPath));
    errors.push(
      `${capability.id}: copy asset contains absolute symlink ${normalizePosix(
        path.join(capability.install.sourcePath, relativePath)
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

  for (const runtimeId of capability.runtimeTargets) {
    if (!repo.runtimes.has(runtimeId)) {
      errors.push(`${capability.id}: unknown runtime target ${runtimeId}.`);
    }
    if (!capability.runtimeBindings[runtimeId]) {
      errors.push(`${capability.id}: runtimeBindings must define ${runtimeId}.`);
    }
  }

  for (const runtimeId of Object.keys(capability.runtimeBindings)) {
    if (!repo.runtimes.has(runtimeId)) {
      errors.push(`${capability.id}: runtimeBindings references unknown runtime ${runtimeId}.`);
    }
  }

  if (capability.assetKind !== capability.id.split(".")[0]) {
    errors.push(`${capability.id}: id prefix must match assetKind.`);
  }

  return errors;
}

async function readResolutionLock(lockPath: string) {
  return resolutionLockSchema.parse(await readJsonFile<ResolutionLock>(lockPath));
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

function deriveDeterministicTimestamp(capabilities: CapabilityRecord[]) {
  const values = capabilities
    .map((capability) => capability.review.reviewedAt)
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
