import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import TOML from "@iarna/toml";
import type {
  BootstrapRecord,
  CapabilityRecord,
  RenderedRuntimeState,
  SharedCacheManifest,
  SourceRecord,
} from "./schema.js";
import {
  capabilitySchema,
  localSecretsSchema,
  sourcesFileSchema,
} from "./schema.js";
import {
  copyDirectoryResolved,
  computeDirectoryDigest,
  computeValueDigest,
  ensureDir,
  listFiles,
  listTopLevelEntries,
  normalizePosix,
  pathExists,
  readJsonFile,
  readText,
  readYamlFile,
  removePath,
  writeJsonFile,
  writeYamlFile,
} from "./io.js";
import { capabilityFilePath, publishGovernance, renderGovernance, syncGovernance } from "./governance.js";

const execFileAsync = promisify(execFile);
const BOOTSTRAP_IMPORT_TAG = "bootstrap-import";
const GOVERNANCE_SOURCE_ID = "governance-repo";

type LocalSecretsAccumulator = {
  runtimeLocalOverrides: Record<string, unknown>;
  secrets: Record<string, string>;
};

type RepoSource = {
  id: string;
  ref: string;
  refType: CapabilityRecord["canonicalSource"]["refType"];
  url: string;
};

type ImportedSummary = {
  capabilityIds: string[];
  mcpCount: number;
  pluginCount: number;
  skippedSkills: string[];
  secretNames: string[];
  skillCount: number;
  syncedRuntimes: string[];
};

type ImportedCapabilityInput = {
  assetKind: CapabilityRecord["assetKind"];
  canonicalPath: string;
  digest: string;
  install: CapabilityRecord["install"];
  name: string;
  permissions: CapabilityRecord["permissions"];
  review: CapabilityRecord["review"];
  riskTier: CapabilityRecord["riskTier"];
  runtimeBindings: CapabilityRecord["runtimeBindings"];
  runtimeTargets: string[];
  tags: string[];
  id: string;
};

type SecretExtractionContext = {
  prefix: string;
  secrets: Record<string, string>;
  extracted: Set<string>;
};

type SkillLockRecord = {
  installedAt?: string;
  pluginName?: string;
  skillFolderHash?: string;
  skillPath?: string;
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  updatedAt?: string;
};

type SkillLockFile = {
  skills?: Record<string, SkillLockRecord>;
};

export async function importLocalMachineState(options: {
  bootstrap: BootstrapRecord;
  machineId?: string;
  reviewer?: string;
  root: string;
  syncRuntimes?: boolean;
}): Promise<ImportedSummary> {
  const machineId = options.machineId ?? options.bootstrap.machineId;
  const reviewer = options.reviewer ?? process.env.USER ?? machineId;
  const reviewTimestamp = new Date().toISOString();
  const assetsRoot = path.join(options.root, "assets");
  const repoSource = await ensureGovernanceRepoSource(options.root);
  const localSecrets = await loadLocalSecretsAccumulator(options.bootstrap.localSecretsFile);
  const importedCapabilities: CapabilityRecord[] = [];

  await removePreviousBootstrapImports(options.root);
  await removePath(path.join(options.root, "vendor", "imported"));
  await removePath(assetsRoot);
  await ensureDir(assetsRoot);

  const sharedSkillImport = await importSharedSkills({
    bootstrap: options.bootstrap,
    localSecrets,
    repoRoot: options.root,
    repoSource,
    reviewTimestamp,
    reviewer,
  });
  importedCapabilities.push(
    ...sharedSkillImport.capabilities
  );
  const skippedSkills = sharedSkillImport.skippedSkills;

  importedCapabilities.push(
    ...(await importCodexRuntimeState({
      homeDir: resolveHomeDir(),
      localSecrets,
      repoRoot: options.root,
      repoSource,
      reviewTimestamp,
      reviewer,
    }))
  );

  importedCapabilities.push(
    ...(await importCursorRuntimeState({
      homeDir: resolveHomeDir(),
      localSecrets,
      repoRoot: options.root,
      repoSource,
      reviewTimestamp,
      reviewer,
    }))
  );

  importedCapabilities.push(
    ...(await importClaudeRuntimeState({
      homeDir: resolveHomeDir(),
      repoRoot: options.root,
      repoSource,
      reviewTimestamp,
      reviewer,
    }))
  );

  for (const capability of importedCapabilities.sort((left, right) => left.id.localeCompare(right.id))) {
    await writeYamlFile(capabilityFilePath(options.root, capability.id), capability);
  }

  await writeYamlFile(options.bootstrap.localSecretsFile, localSecretsSchema.parse(localSecrets));

  const lock = await publishGovernance(options.root);
  const rendered = await renderGovernance({
    root: options.root,
    machineId,
    bootstrap: options.bootstrap,
  });

  await seedManagedState(options.bootstrap, rendered.sharedCacheManifest, rendered.renderedStates);

  const syncedRuntimes: string[] = [];
  if (options.syncRuntimes ?? true) {
    for (const runtimeState of rendered.renderedStates) {
      await syncGovernance({
        root: options.root,
        machineId,
        runtimeId: runtimeState.runtimeId,
        bootstrap: options.bootstrap,
      });
      syncedRuntimes.push(runtimeState.runtimeId);
    }
  }

  return {
    capabilityIds: lock.capabilities.map((capability) => capability.id),
    skillCount: importedCapabilities.filter((capability) => capability.assetKind === "skill").length,
    pluginCount: importedCapabilities.filter((capability) => capability.assetKind === "plugin").length,
    mcpCount: importedCapabilities.filter((capability) => capability.assetKind === "mcp").length,
    skippedSkills,
    secretNames: Object.keys(localSecrets.secrets).sort(),
    syncedRuntimes,
  };
}

async function importSharedSkills(args: {
  bootstrap: BootstrapRecord;
  localSecrets: LocalSecretsAccumulator;
  repoRoot: string;
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
}) {
  const skillsRoot = path.join(args.bootstrap.cacheRoot, "skills");
  if (!(await pathExists(skillsRoot))) {
    return {
      capabilities: [],
      skippedSkills: [],
    };
  }

  const lockFile = await readOptionalJson<SkillLockFile>(
    path.join(args.bootstrap.cacheRoot, ".skill-lock.json"),
    {}
  );
  const capabilities: CapabilityRecord[] = [];
  const skippedSkills: string[] = [];
  const skillEntries = await listTopLevelEntries(skillsRoot);

  for (const entry of skillEntries) {
    if (entry.kind !== "directory") {
      continue;
    }
    if (!(await pathExists(path.join(entry.path, "SKILL.md")))) {
      skippedSkills.push(entry.name);
      continue;
    }

    const artifactName = entry.name;
    const relativeSourcePath = path.join("assets", "skills", artifactName);
    const targetPath = path.join(args.repoRoot, relativeSourcePath);
    await copyImportedDirectory(entry.path, targetPath);

    const provenance = lockFile.skills?.[artifactName];
    capabilities.push(
      buildImportedCapability({
        assetKind: "skill",
        canonicalPath: relativeSourcePath,
        digest: await computeDirectoryDigest(targetPath),
        id: `skill.imported.${artifactName}`,
        install: {
          strategy: "copy",
          artifactName,
          sourcePath: normalizePosix(relativeSourcePath),
          manifest: withDefinedValues({
            importedFrom: "shared-skill-cache",
            ...(provenance
              ? {
                  source: provenance.source,
                  sourceType: provenance.sourceType,
                  sourceUrl: provenance.sourceUrl,
                  skillPath: provenance.skillPath,
                  skillFolderHash: provenance.skillFolderHash,
                  pluginName: provenance.pluginName,
                  installedAt: provenance.installedAt,
                  updatedAt: provenance.updatedAt,
                }
              : {
                  localPath: entry.path,
                }),
          }),
        },
        name: artifactName,
        permissions: {
          localRead: "scoped",
          network: false,
          credentials: false,
          filesystemWrite: "none",
        },
        review: {
          status: "approved",
          reviewer: args.reviewer,
          reviewedAt: args.reviewTimestamp,
          license: "UNKNOWN",
          executesScripts: false,
          networkAccess: false,
          touchesCredentials: false,
          filesystemSideEffects: "none",
          notes: ["Imported from the local shared skill cache."],
        },
        riskTier: "T1",
        runtimeBindings: {
          codex: {
            skill: {
              syncMode: "cache-only",
            },
          },
        },
        runtimeTargets: ["codex"],
        tags: [BOOTSTRAP_IMPORT_TAG, "shared-skill"],
        repoSource: args.repoSource,
      })
    );
  }

  return {
    capabilities,
    skippedSkills,
  };
}

async function importCodexRuntimeState(args: {
  homeDir: string;
  localSecrets: LocalSecretsAccumulator;
  repoRoot: string;
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
}) {
  const configPath = path.join(args.homeDir, ".codex", "config.toml");
  if (!(await pathExists(configPath))) {
    return [];
  }

  const parsed = TOML.parse(await readText(configPath)) as TOML.JsonMap;
  const capabilities: CapabilityRecord[] = [];

  for (const [pluginId, rawConfig] of sortedEntries(asRecord(parsed.plugins))) {
    const config = asRecord(rawConfig);
    const parsedPluginId = parsePluginId(pluginId);
    const artifactName = buildPluginArtifactName("codex", parsedPluginId.name);
    const localSourceDir = await firstExistingPath([
      path.join(args.homeDir, ".codex", ".tmp", "plugins", "plugins", parsedPluginId.name),
      path.join(args.homeDir, ".codex", "plugins", parsedPluginId.name),
    ]);
    const relativeSourcePath = path.join("assets", "packages", artifactName);
    const install =
      localSourceDir && (await pathExists(path.join(localSourceDir, ".codex-plugin", "plugin.json")))
        ? await buildCopiedInstall(args.repoRoot, relativeSourcePath, localSourceDir, {
            importedFrom: "codex-plugin-cache",
            pluginId,
            localPath: localSourceDir,
          })
        : {
            strategy: "external" as const,
            artifactName,
            manifest: {
              importedFrom: "codex-config",
              pluginId,
            },
          };

    capabilities.push(
      buildImportedCapability({
        assetKind: "plugin",
        canonicalPath:
          install.strategy === "copy" && install.sourcePath
            ? install.sourcePath
            : normalizePosix(path.join("registry", "capabilities", `plugin.imported.codex.${parsedPluginId.name}.yaml`)),
        digest:
          install.strategy === "copy" && install.sourcePath
            ? await computeDirectoryDigest(path.join(args.repoRoot, install.sourcePath))
            : computeValueDigest({ pluginId, config }),
        id: `plugin.imported.codex.${parsedPluginId.name}`,
        install,
        name: parsedPluginId.name,
        permissions: {
          localRead: "scoped",
          network: true,
          credentials: false,
          filesystemWrite: "runtime-only",
        },
        review: {
          status: "approved",
          reviewer: args.reviewer,
          reviewedAt: args.reviewTimestamp,
          license: await readPluginLicense(localSourceDir, ".codex-plugin", "plugin.json"),
          executesScripts: true,
          networkAccess: true,
          touchesCredentials: false,
          filesystemSideEffects: "runtime plugin execution",
          notes: ["Imported from the local Codex plugin configuration."],
        },
        riskTier: "T2",
        runtimeBindings: {
          codex: {
            plugin: {
              pluginId,
              enabled: config.enabled !== false,
              installedRecords: [],
            },
          },
        },
        runtimeTargets: ["codex"],
        tags: [BOOTSTRAP_IMPORT_TAG, "codex-plugin"],
        repoSource: args.repoSource,
      })
    );
  }

  for (const [serverName, rawConfig] of sortedEntries(asRecord(parsed.mcp_servers))) {
    const secretContext = createSecretContext("IMPORTED_CODEX_MCP", args.localSecrets);
    const sanitizedConfig = sanitizeSensitiveValues(rawConfig, [serverName], secretContext);
    capabilities.push(
      buildMcpCapability({
        configPath,
        hasSecrets: secretContext.extracted.size > 0,
        id: `mcp.imported.codex.${serverName}`,
        name: serverName,
        repoSource: args.repoSource,
        reviewTimestamp: args.reviewTimestamp,
        reviewer: args.reviewer,
        runtimeId: "codex",
        sanitizedConfig,
        serverName,
      })
    );
  }

  return capabilities;
}

async function importCursorRuntimeState(args: {
  homeDir: string;
  localSecrets: LocalSecretsAccumulator;
  repoRoot: string;
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
}) {
  const configPath = path.join(args.homeDir, ".cursor", "mcp.json");
  if (!(await pathExists(configPath))) {
    return [];
  }

  const parsed = await readJsonFile<Record<string, unknown>>(configPath);
  const capabilities: CapabilityRecord[] = [];

  for (const [serverName, rawConfig] of sortedEntries(asRecord(parsed.mcpServers))) {
    const secretContext = createSecretContext("IMPORTED_CURSOR_MCP", args.localSecrets);
    const sanitizedConfig = sanitizeSensitiveValues(rawConfig, [serverName], secretContext);
    capabilities.push(
      buildMcpCapability({
        configPath,
        hasSecrets: secretContext.extracted.size > 0,
        id: `mcp.imported.cursor.${serverName}`,
        name: serverName,
        repoSource: args.repoSource,
        reviewTimestamp: args.reviewTimestamp,
        reviewer: args.reviewer,
        runtimeId: "cursor",
        sanitizedConfig,
        serverName,
      })
    );
  }

  return capabilities;
}

async function importClaudeRuntimeState(args: {
  homeDir: string;
  repoRoot: string;
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
}) {
  const settingsPath = path.join(args.homeDir, ".claude", "settings.json");
  const knownMarketplacesPath = path.join(args.homeDir, ".claude", "plugins", "known_marketplaces.json");
  const installedPluginsPath = path.join(args.homeDir, ".claude", "plugins", "installed_plugins.json");
  if (!(await pathExists(settingsPath))) {
    return [];
  }

  const settings = await readJsonFile<Record<string, unknown>>(settingsPath);
  const enabledPlugins = asRecord(settings.enabledPlugins);
  const knownMarketplaces = (await pathExists(knownMarketplacesPath))
    ? await readJsonFile<Record<string, unknown>>(knownMarketplacesPath)
    : {};
  const installedPlugins = (await pathExists(installedPluginsPath))
    ? await readJsonFile<Record<string, unknown>>(installedPluginsPath)
    : {};
  const installedByPlugin = asRecord(installedPlugins.plugins);
  const pluginIds = new Set<string>();

  for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
    if (enabled === true) {
      pluginIds.add(pluginId);
    }
  }
  for (const pluginId of Object.keys(installedByPlugin)) {
    pluginIds.add(pluginId);
  }

  const capabilities: CapabilityRecord[] = [];
  for (const pluginId of [...pluginIds].sort()) {
    const parsedPluginId = parsePluginId(pluginId);
    const knownMarketplace = asRecord(knownMarketplaces[parsedPluginId.marketplaceId ?? ""]);
    const installedRecords = asRecordArray(installedByPlugin[pluginId]);
    const localSourceDir = await resolveClaudePluginDirectory({
      homeDir: args.homeDir,
      installedRecords,
      knownMarketplace,
      marketplaceId: parsedPluginId.marketplaceId,
    });
    const artifactName = buildPluginArtifactName("claude", parsedPluginId.name);
    const relativeSourcePath = path.join("assets", "packages", artifactName);
    const install =
      localSourceDir && (await pathExists(path.join(localSourceDir, ".claude-plugin", "plugin.json")))
        ? await buildCopiedInstall(args.repoRoot, relativeSourcePath, localSourceDir, {
            importedFrom: "claude-plugin-marketplace",
            pluginId,
            localPath: localSourceDir,
          })
        : {
            strategy: "external" as const,
            artifactName,
            manifest: {
              importedFrom: "claude-settings",
              pluginId,
              marketplaceId: parsedPluginId.marketplaceId,
            },
          };

    capabilities.push(
      buildImportedCapability({
        assetKind: "plugin",
        canonicalPath:
          install.strategy === "copy" && install.sourcePath
            ? install.sourcePath
            : normalizePosix(path.join("registry", "capabilities", `plugin.imported.claude.${parsedPluginId.name}.yaml`)),
        digest:
          install.strategy === "copy" && install.sourcePath
            ? await computeDirectoryDigest(path.join(args.repoRoot, install.sourcePath))
            : computeValueDigest({ pluginId, knownMarketplace, installedRecords }),
        id: `plugin.imported.claude.${parsedPluginId.name}`,
        install,
        name: parsedPluginId.name,
        permissions: {
          localRead: "scoped",
          network: true,
          credentials: false,
          filesystemWrite: "runtime-only",
        },
        review: {
          status: "approved",
          reviewer: args.reviewer,
          reviewedAt: args.reviewTimestamp,
          license: await readPluginLicense(localSourceDir, ".claude-plugin", "plugin.json"),
          executesScripts: true,
          networkAccess: true,
          touchesCredentials: false,
          filesystemSideEffects: "runtime plugin execution",
          notes: ["Imported from the local Claude plugin configuration."],
        },
        riskTier: "T2",
        runtimeBindings: {
          claude: {
            plugin: {
              pluginId,
              enabled: enabledPlugins[pluginId] === true,
              ...(parsedPluginId.marketplaceId && Object.keys(knownMarketplace).length > 0
                ? {
                    knownMarketplace: {
                      marketplaceId: parsedPluginId.marketplaceId,
                      ...knownMarketplace,
                      installLocation: `\${CACHE_ROOT}/packages/${artifactName}`,
                    },
                  }
                : {}),
              installedRecords: installedRecords.map((record) => ({
                ...record,
                installPath: `\${CACHE_ROOT}/packages/${artifactName}`,
              })),
            },
          },
        },
        runtimeTargets: ["claude"],
        tags: [BOOTSTRAP_IMPORT_TAG, "claude-plugin"],
        repoSource: args.repoSource,
      })
    );
  }

  return capabilities;
}

function buildImportedCapability(
  input: ImportedCapabilityInput & {
    repoSource: RepoSource;
  }
) {
  return capabilitySchema.parse({
    id: input.id,
    name: input.name,
    assetKind: input.assetKind,
    runtimeTargets: input.runtimeTargets,
    runtimeBindings: input.runtimeBindings,
    discoverySources: [],
    canonicalSource: {
      sourceId: input.repoSource.id,
      url: input.repoSource.url,
      ref: input.repoSource.ref,
      refType: input.repoSource.refType,
      path: normalizePosix(input.canonicalPath),
    },
    install: input.install,
    riskTier: input.riskTier,
    permissions: input.permissions,
    review: input.review,
    lifecycleState: "published",
    versionPolicy: {
      strategy: "pin-ref-and-hash",
      allowUpdates: "manual",
    },
    hash: {
      algorithm: "sha256",
      digest: input.digest,
    },
    tags: [...new Set(input.tags)].sort(),
  });
}

function withDefinedValues<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, innerValue]) => innerValue !== undefined)
  ) as T;
}

function buildMcpCapability(args: {
  configPath: string;
  hasSecrets: boolean;
  id: string;
  name: string;
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
  runtimeId: string;
  sanitizedConfig: unknown;
  serverName: string;
}) {
  return buildImportedCapability({
    assetKind: "mcp",
    canonicalPath: normalizePosix(path.join("registry", "capabilities", `${args.id}.yaml`)),
    digest: computeValueDigest({
      runtimeId: args.runtimeId,
      serverName: args.serverName,
      config: args.sanitizedConfig,
    }),
    id: args.id,
    install: {
      strategy: "manifest",
      artifactName: `${args.runtimeId}-${args.serverName}`,
      manifest: {
        importedFrom: args.configPath,
      },
    },
    name: `${args.name} (${args.runtimeId})`,
    permissions: {
      localRead: "scoped",
      network: true,
      credentials: args.hasSecrets,
      filesystemWrite: "runtime-only",
    },
    review: {
      status: "approved",
      reviewer: args.reviewer,
      reviewedAt: args.reviewTimestamp,
      license: "CONFIG_ONLY",
      executesScripts: configLooksExecutable(args.sanitizedConfig),
      networkAccess: true,
      touchesCredentials: args.hasSecrets,
      filesystemSideEffects: "runtime MCP process access",
      notes: [`Imported from ${args.runtimeId} runtime MCP configuration.`],
    },
    riskTier: args.hasSecrets ? "T3" : "T2",
    runtimeBindings: {
      [args.runtimeId]: {
        mcp: {
          serverName: args.serverName,
          config: asRecord(args.sanitizedConfig),
        },
      },
    },
    runtimeTargets: [args.runtimeId],
    tags: [BOOTSTRAP_IMPORT_TAG, `${args.runtimeId}-mcp`],
    repoSource: args.repoSource,
  });
}

async function removePreviousBootstrapImports(root: string) {
  const capabilityFiles = await listFiles(path.join(root, "registry", "capabilities"), ".yaml");
  for (const filePath of capabilityFiles) {
    const parsed = capabilitySchema.parse(await readYamlFile(filePath));
    if (!parsed.tags.includes(BOOTSTRAP_IMPORT_TAG)) {
      continue;
    }
    await removePath(filePath);
  }
}

async function ensureGovernanceRepoSource(root: string): Promise<RepoSource> {
  const sourceFile = path.join(root, "registry", "sources.yaml");
  const parsed = sourcesFileSchema.parse(await readYamlFile(sourceFile));
  const existing = parsed.sources.find((source) => source.id === GOVERNANCE_SOURCE_ID);
  const url = existing?.url ?? (await resolveGovernanceRepoUrl(root));
  const nextSource: SourceRecord = existing ?? {
    id: GOVERNANCE_SOURCE_ID,
    kind: "repo",
    url,
    discoveryOnly: false,
    trustLevel: "governance-repo",
    owner: "self",
    notes: ["Canonical source for imported local bootstrap artifacts."],
  };

  if (!existing) {
    parsed.sources.push(nextSource);
    parsed.sources.sort((left, right) => left.id.localeCompare(right.id));
    await writeYamlFile(sourceFile, parsed);
  }

  return {
    id: GOVERNANCE_SOURCE_ID,
    url: nextSource.url,
    ref: await resolveGovernanceRepoRef(root),
    refType: "branch",
  };
}

async function seedManagedState(
  bootstrap: BootstrapRecord,
  sharedCacheManifest: SharedCacheManifest,
  renderedStates: RenderedRuntimeState[]
) {
  const managedCachePaths = [
    ...sharedCacheManifest.skills.map((skill) => skill.relativePath),
    ...sharedCacheManifest.packages.map((pkg) => pkg.relativePath),
    path.join("manifests", "shared-cache-manifest.json"),
  ]
    .map((relativePath) => normalizePosix(relativePath))
    .sort();

  await writeJsonFile(path.join(bootstrap.cacheRoot, ".agent-governance-cache-state.json"), {
    managedPaths: managedCachePaths,
  });

  for (const runtimeState of renderedStates) {
    switch (runtimeState.runtimeId) {
      case "codex":
        await writeJsonFile(runtimeState.ownedStateFile, {
          managedPluginIds: runtimeState.plugins.map((plugin) => plugin.pluginId),
          managedMcpServerNames: runtimeState.mcps.map((mcp) => mcp.serverName),
        });
        break;
      case "cursor":
        await writeJsonFile(runtimeState.ownedStateFile, {
          managedSkillIds: runtimeState.skills
            .filter((skill) => skill.syncMode === "user-skill-dir")
            .map((skill) => skill.artifactName),
          managedMcpServerNames: runtimeState.mcps.map((mcp) => mcp.serverName),
        });
        break;
      case "claude":
        await writeJsonFile(runtimeState.ownedStateFile, {
          managedEnabledPluginIds: runtimeState.plugins.map((plugin) => plugin.pluginId),
          managedMarketplaceIds: runtimeState.plugins
            .map((plugin) => plugin.knownMarketplace?.marketplaceId)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
          managedInstalledPluginIds: runtimeState.plugins
            .filter((plugin) => plugin.installedRecords.length > 0)
            .map((plugin) => plugin.pluginId),
        });
        break;
      default:
        break;
    }
  }
}

async function resolveClaudePluginDirectory(args: {
  homeDir: string;
  installedRecords: Array<Record<string, unknown>>;
  knownMarketplace: Record<string, unknown>;
  marketplaceId: string | null;
}) {
  const candidates = [
    args.marketplaceId
      ? path.join(args.homeDir, ".claude", "plugins", "marketplaces", args.marketplaceId)
      : null,
    typeof args.knownMarketplace.installLocation === "string"
      ? args.knownMarketplace.installLocation
      : null,
    ...args.installedRecords.map((record) =>
      typeof record.installPath === "string" ? record.installPath : null
    ),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, ".claude-plugin", "plugin.json"))) {
      return candidate;
    }
  }

  return null;
}

async function buildCopiedInstall(
  root: string,
  relativeSourcePath: string,
  sourceDir: string,
  manifest: Record<string, unknown>
) {
  const targetPath = path.join(root, relativeSourcePath);
  await copyImportedDirectory(sourceDir, targetPath);
  return {
    strategy: "copy" as const,
    artifactName: path.basename(relativeSourcePath),
    sourcePath: normalizePosix(relativeSourcePath),
    manifest,
  };
}

async function readPluginLicense(
  sourceDir: string | null,
  pluginDirName: ".claude-plugin" | ".codex-plugin",
  fileName: "plugin.json"
) {
  if (!sourceDir) {
    return "UNKNOWN";
  }
  const manifestPath = path.join(sourceDir, pluginDirName, fileName);
  if (!(await pathExists(manifestPath))) {
    return "UNKNOWN";
  }
  const parsed = await readJsonFile<Record<string, unknown>>(manifestPath);
  return typeof parsed.license === "string" && parsed.license.length > 0 ? parsed.license : "UNKNOWN";
}

function createSecretContext(prefix: string, localSecrets: LocalSecretsAccumulator): SecretExtractionContext {
  return {
    prefix,
    secrets: localSecrets.secrets,
    extracted: new Set<string>(),
  };
}

function sanitizeSensitiveValues(
  value: unknown,
  pathSegments: string[],
  context: SecretExtractionContext
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeSensitiveValues(item, [...pathSegments, String(index)], context)
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [
        key,
        sanitizeSensitiveValues(innerValue, [...pathSegments, key], context),
      ])
    );
  }

  if (typeof value === "string" && shouldSecretize(pathSegments, value)) {
    const secretName = upsertSecret(context.secrets, buildSecretName(context.prefix, pathSegments), value);
    context.extracted.add(secretName);
    return `\${SECRET:${secretName}}`;
  }

  return value;
}

function shouldSecretize(pathSegments: string[], value: string) {
  if (!value || value.startsWith("${SECRET:")) {
    return false;
  }

  const key = pathSegments.at(-1)?.toLowerCase() ?? "";
  const parent = pathSegments.at(-2)?.toLowerCase() ?? "";
  if (parent === "env" || parent === "headers") {
    return true;
  }

  return /(token|secret|api[_-]?key|password|passwd|authorization|cookie|session)/i.test(key);
}

function buildSecretName(prefix: string, pathSegments: string[]) {
  return [prefix, ...pathSegments]
    .map((segment) => segment.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase())
    .filter((segment) => segment.length > 0)
    .join("_");
}

function upsertSecret(secrets: Record<string, string>, baseName: string, value: string) {
  let candidate = baseName;
  let counter = 2;
  while (candidate in secrets && secrets[candidate] !== value) {
    candidate = `${baseName}_${counter}`;
    counter += 1;
  }
  secrets[candidate] = value;
  return candidate;
}

function parsePluginId(pluginId: string) {
  const separator = pluginId.lastIndexOf("@");
  if (separator === -1) {
    return {
      marketplaceId: null,
      name: pluginId,
    };
  }

  return {
    marketplaceId: pluginId.slice(separator + 1),
    name: pluginId.slice(0, separator),
  };
}

function buildPluginArtifactName(runtimeId: string, name: string) {
  return `${runtimeId}-${name}`.replace(/[^a-zA-Z0-9-]+/g, "-");
}

function configLooksExecutable(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.command === "string" || typeof record.url === "string";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
}

function sortedEntries(value: Record<string, unknown>) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

async function loadLocalSecretsAccumulator(localSecretsPath: string): Promise<LocalSecretsAccumulator> {
  if (!(await pathExists(localSecretsPath))) {
    return {
      secrets: {},
      runtimeLocalOverrides: {},
    };
  }

  return localSecretsSchema.parse(await readYamlFile(localSecretsPath));
}

async function resolveGovernanceRepoUrl(root: string) {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: root,
    });
    return normalizeGitUrl(stdout.trim());
  } catch {
    return pathToFileUrl(root);
  }
}

async function resolveGovernanceRepoRef(root: string) {
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: root,
    });
    const ref = stdout.trim();
    return ref.length > 0 ? ref : "main";
  } catch {
    return "main";
  }
}

function normalizeGitUrl(value: string) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\.git$/, "");
  }

  const scpLike = value.match(/^git@([^:]+):(.+)$/);
  if (scpLike) {
    return `https://${scpLike[1]}/${scpLike[2]!.replace(/\.git$/, "")}`;
  }

  return value.startsWith("file://") ? value : pathToFileUrl(value);
}

function pathToFileUrl(filePath: string) {
  return new URL(`file://${path.resolve(filePath)}`).toString();
}

async function readOptionalJson<T>(filePath: string, fallback: T) {
  return (await pathExists(filePath)) ? readJsonFile<T>(filePath) : fallback;
}

async function firstExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveHomeDir() {
  return process.env.HOME ?? os.homedir();
}

async function copyImportedDirectory(sourceDir: string, targetDir: string) {
  await copyDirectoryResolved(sourceDir, targetDir);
}
