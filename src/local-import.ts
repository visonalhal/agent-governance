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
  RuntimeRecord,
  SharedCacheManifest,
  SourceRecord,
} from "./schema.js";
import {
  capabilitySchema,
  localSecretsSchema,
  runtimeSchema,
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
  writeText,
  writeYamlFile,
} from "./io.js";
import {
  capabilityFilePath,
  loadRepo,
  publishGovernance,
  renderGovernance,
  syncGovernance,
} from "./governance.js";

const execFileAsync = promisify(execFile);
const BOOTSTRAP_IMPORT_TAG = "bootstrap-seeded";
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

type SeededSummary = {
  capabilityIds: string[];
  mcpCount: number;
  pluginBindingCount: number;
  pluginCount: number;
  skippedSkills: string[];
  secretNames: string[];
  skillCount: number;
  syncedRuntimes: string[];
};

type ExistingCapabilityIndex = {
  byId: Map<string, CapabilityRecord>;
  mcpsByName: Map<string, CapabilityRecord>;
  pluginsByName: Map<string, CapabilityRecord>;
  skillsByName: Map<string, CapabilityRecord>;
};

type SeededCapabilityInput = {
  assetKind: CapabilityRecord["assetKind"];
  bindings: CapabilityRecord["bindings"];
  canonicalPath: string;
  digest: string;
  entrypoints?: CapabilityRecord["entrypoints"];
  exposes?: CapabilityRecord["exposes"];
  includes?: CapabilityRecord["includes"];
  install: CapabilityRecord["install"];
  name: string;
  permissions: CapabilityRecord["permissions"];
  review: CapabilityRecord["review"];
  riskTier: CapabilityRecord["riskTier"];
  tags: string[];
  id: string;
};

type RuntimePolicyAccumulator = Map<
  string,
  {
    enabledCapabilityIds: Set<string>;
    overrides: Map<string, string | "disabled">;
  }
>;

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
}): Promise<SeededSummary> {
  const machineId = options.machineId ?? options.bootstrap.machineId;
  const reviewer = options.reviewer ?? process.env.USER ?? machineId;
  const reviewTimestamp = new Date().toISOString();
  const assetsRoot = path.join(options.root, "assets");
  const repoSource = await ensureGovernanceRepoSource(options.root);
  const localSecrets = await loadLocalSecretsAccumulator(options.bootstrap.localSecretsFile);
  const seededCapabilities = new Map<string, CapabilityRecord>();
  const runtimePolicies = createRuntimePolicyAccumulator();
  let pluginBindingCount = 0;

  await removePreviousBootstrapSeededArtifacts(options.root);
  await removePath(path.join(options.root, "vendor", "bootstrap-seeded"));
  await ensureDir(assetsRoot);
  const existingCapabilities = buildExistingCapabilityIndex((await loadRepo(options.root)).capabilities);

  const sharedSkillImport = await importSharedSkills({
    bootstrap: options.bootstrap,
    existingCapabilities,
    localSecrets,
    repoRoot: options.root,
    repoSource,
    reviewTimestamp,
    reviewer,
  });
  for (const capability of sharedSkillImport.capabilities) {
    mergeSeededCapability(seededCapabilities, capability);
  }
  mergeRuntimePolicies(runtimePolicies, sharedSkillImport.runtimePolicies);
  const skippedSkills = sharedSkillImport.skippedSkills;

  const codexImport = await importCodexRuntimeState({
    existingCapabilities,
    homeDir: resolveHomeDir(),
    localSecrets,
    repoRoot: options.root,
    repoSource,
    reviewTimestamp,
    reviewer,
  });
  for (const capability of codexImport.capabilities) {
    seedAndMergeCapability(seededCapabilities, existingCapabilities, capability);
  }
  mergeRuntimePolicies(runtimePolicies, codexImport.runtimePolicies);
  pluginBindingCount += codexImport.pluginBindingCount;

  const cursorImport = await importCursorRuntimeState({
    existingCapabilities,
    homeDir: resolveHomeDir(),
    localSecrets,
    repoRoot: options.root,
    repoSource,
    reviewTimestamp,
    reviewer,
  });
  for (const capability of cursorImport.capabilities) {
    seedAndMergeCapability(seededCapabilities, existingCapabilities, capability);
  }
  mergeRuntimePolicies(runtimePolicies, cursorImport.runtimePolicies);

  const claudeImport = await importClaudeRuntimeState({
    existingCapabilities,
    homeDir: resolveHomeDir(),
    repoRoot: options.root,
    repoSource,
    reviewTimestamp,
    reviewer,
  });
  for (const capability of claudeImport.capabilities) {
    seedAndMergeCapability(seededCapabilities, existingCapabilities, capability);
  }
  mergeRuntimePolicies(runtimePolicies, claudeImport.runtimePolicies);
  pluginBindingCount += claudeImport.pluginBindingCount;

  for (const capability of [...seededCapabilities.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    await writeYamlFile(capabilityFilePath(options.root, capability.id), capability);
  }
  await applyRuntimePolicies(options.root, runtimePolicies);

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
    skillCount: [...seededCapabilities.values()].filter((capability) => capability.assetKind === "skill")
      .length,
    pluginCount: [...seededCapabilities.values()].filter((capability) => capability.assetKind === "plugin")
      .length,
    pluginBindingCount,
    mcpCount: [...seededCapabilities.values()].filter((capability) => capability.assetKind === "mcp").length,
    skippedSkills,
    secretNames: Object.keys(localSecrets.secrets).sort(),
    syncedRuntimes,
  };
}

async function importSharedSkills(args: {
  bootstrap: BootstrapRecord;
  existingCapabilities: ExistingCapabilityIndex;
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
      runtimePolicies: createRuntimePolicyAccumulator(),
      skippedSkills: [],
    };
  }

  const lockFile = await readOptionalJson<SkillLockFile>(
    path.join(args.bootstrap.cacheRoot, ".skill-lock.json"),
    {}
  );
  const capabilities: CapabilityRecord[] = [];
  const runtimePolicies = createRuntimePolicyAccumulator();
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
    const existingSkill = args.existingCapabilities.skillsByName.get(artifactName);
    const relativeSourcePath = path.join("assets", "skills", artifactName);
    const targetPath = path.join(args.repoRoot, relativeSourcePath);
    await copySeededDirectory(entry.path, targetPath);

    const provenance = lockFile.skills?.[artifactName];
    capabilities.push(
      buildSeededCapability({
        assetKind: "skill",
        bindings: {
          cache: {
            skill: {
              syncMode: "cache-only",
            },
          },
          "user-dir": {
            skill: {
              syncMode: "user-skill-dir",
            },
          },
        },
        canonicalPath: relativeSourcePath,
        digest: await computeDirectoryDigest(targetPath),
        id: existingSkill?.id ?? `skill.${artifactName}`,
        install: {
          strategy: "copy",
          artifactName,
          sourcePath: normalizePosix(relativeSourcePath),
          manifest: withDefinedValues({
            seededFrom: "shared-skill-cache",
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
          notes: ["Seeded from the local shared skill cache."],
        },
        riskTier: "T1",
        tags: [BOOTSTRAP_IMPORT_TAG, "shared-skill"],
        repoSource: args.repoSource,
      })
    );
    noteRuntimeSelection(runtimePolicies, "codex", existingSkill?.id ?? `skill.${artifactName}`);
  }

  return {
    capabilities,
    runtimePolicies,
    skippedSkills,
  };
}

async function importCodexRuntimeState(args: {
  existingCapabilities: ExistingCapabilityIndex;
  homeDir: string;
  localSecrets: LocalSecretsAccumulator;
  repoRoot: string;
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
}) {
  const configPath = path.join(args.homeDir, ".codex", "config.toml");
  if (!(await pathExists(configPath))) {
    return {
      capabilities: [] as CapabilityRecord[],
      pluginBindingCount: 0,
      runtimePolicies: createRuntimePolicyAccumulator(),
    };
  }

  const parsed = TOML.parse(await readText(configPath)) as TOML.JsonMap;
  const capabilities: CapabilityRecord[] = [];
  const runtimePolicies = createRuntimePolicyAccumulator();
  let pluginBindingCount = 0;

  for (const [pluginId, rawConfig] of sortedEntries(asRecord(parsed.plugins))) {
    const config = asRecord(rawConfig);
    const parsedPluginId = parsePluginId(pluginId);
    const artifactName = buildPluginArtifactName("codex", parsedPluginId.name);
    const existingPlugin = args.existingCapabilities.pluginsByName.get(parsedPluginId.name);
    const canonicalPluginId = existingPlugin?.id ?? `plugin.${parsedPluginId.name}`;
    const pluginAssetPath = await ensurePluginAssetRoot(args.repoRoot, canonicalPluginId, parsedPluginId.name, {
      sourceLabel: "Seeded from local plugin configuration",
      runtimeId: "codex",
      existingCapability: existingPlugin,
    });
    const localSourceDir = await firstExistingPath([
      path.join(args.homeDir, ".codex", ".tmp", "plugins", "plugins", parsedPluginId.name),
      path.join(args.homeDir, ".codex", "plugins", parsedPluginId.name),
    ]);
    const relativeSourcePath = path.join(pluginAssetPath, "targets", "codex");
    const install =
      localSourceDir && (await pathExists(path.join(localSourceDir, ".codex-plugin", "plugin.json")))
        ? await buildCopiedInstall(args.repoRoot, relativeSourcePath, localSourceDir, {
            artifactName,
            seededFrom: "codex-plugin-cache",
            pluginId,
            localPath: localSourceDir,
          })
        : {
            strategy: "external" as const,
            artifactName,
            manifest: {
              seededFrom: "codex-config",
              pluginId,
            },
          };
    const bindingId = install.strategy === "external" ? "external" : "package";

    capabilities.push(
      buildSeededCapability({
        assetKind: "plugin",
        bindings: {
          [bindingId]: {
            plugin: {
              install,
              nativeRegistration: {
                pluginId,
                enabled: config.enabled !== false,
                installedRecords: [],
              },
            },
          },
        },
        canonicalPath: pluginAssetPath,
        digest: await computeDirectoryDigest(path.join(args.repoRoot, pluginAssetPath)),
        id: canonicalPluginId,
        install: {
          strategy: "copy",
          artifactName: parsedPluginId.name,
          sourcePath: pluginAssetPath,
        },
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
          notes: ["Seeded from the local Codex plugin configuration."],
        },
        riskTier: "T2",
        tags: [BOOTSTRAP_IMPORT_TAG, "plugin-import"],
        repoSource: args.repoSource,
      })
    );
    noteRuntimeSelection(runtimePolicies, "codex", canonicalPluginId, bindingId);
    pluginBindingCount += 1;
  }

  for (const [serverName, rawConfig] of sortedEntries(asRecord(parsed.mcp_servers))) {
    const secretContext = createSecretContext("SEEDED_CODEX_MCP", args.localSecrets);
    const sanitizedConfig = sanitizeSensitiveValues(rawConfig, [serverName], secretContext);
    const existingMcp = args.existingCapabilities.mcpsByName.get(serverName);
    capabilities.push(
      buildMcpCapability({
        configPath,
        hasSecrets: secretContext.extracted.size > 0,
        id: existingMcp?.id ?? `mcp.${serverName}`,
        repoSource: args.repoSource,
        reviewTimestamp: args.reviewTimestamp,
        reviewer: args.reviewer,
        runtimeId: "codex",
        sanitizedConfig,
        serverName,
        tags: existingMcp ? ["mcp-import"] : [BOOTSTRAP_IMPORT_TAG, "mcp-import"],
      })
    );
    noteRuntimeSelection(
      runtimePolicies,
      "codex",
      existingMcp?.id ?? `mcp.${serverName}`,
      bindingIdForMcpConfig(sanitizedConfig)
    );
  }

  return {
    capabilities,
    pluginBindingCount,
    runtimePolicies,
  };
}

async function importCursorRuntimeState(args: {
  existingCapabilities: ExistingCapabilityIndex;
  homeDir: string;
  localSecrets: LocalSecretsAccumulator;
  repoRoot: string;
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
}) {
  const configPath = path.join(args.homeDir, ".cursor", "mcp.json");
  if (!(await pathExists(configPath))) {
    return {
      capabilities: [] as CapabilityRecord[],
      runtimePolicies: createRuntimePolicyAccumulator(),
    };
  }

  const parsed = await readJsonFile<Record<string, unknown>>(configPath);
  const capabilities: CapabilityRecord[] = [];
  const runtimePolicies = createRuntimePolicyAccumulator();

  for (const [serverName, rawConfig] of sortedEntries(asRecord(parsed.mcpServers))) {
    const secretContext = createSecretContext("SEEDED_CURSOR_MCP", args.localSecrets);
    const sanitizedConfig = sanitizeSensitiveValues(rawConfig, [serverName], secretContext);
    const existingMcp = args.existingCapabilities.mcpsByName.get(serverName);
    capabilities.push(
      buildMcpCapability({
        configPath,
        hasSecrets: secretContext.extracted.size > 0,
        id: existingMcp?.id ?? `mcp.${serverName}`,
        repoSource: args.repoSource,
        reviewTimestamp: args.reviewTimestamp,
        reviewer: args.reviewer,
        runtimeId: "cursor",
        sanitizedConfig,
        serverName,
        tags: existingMcp ? ["mcp-import"] : [BOOTSTRAP_IMPORT_TAG, "mcp-import"],
      })
    );
    noteRuntimeSelection(
      runtimePolicies,
      "cursor",
      existingMcp?.id ?? `mcp.${serverName}`,
      bindingIdForMcpConfig(sanitizedConfig)
    );
  }

  return {
    capabilities,
    runtimePolicies,
  };
}

async function importClaudeRuntimeState(args: {
  existingCapabilities: ExistingCapabilityIndex;
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
    return {
      capabilities: [] as CapabilityRecord[],
      pluginBindingCount: 0,
      runtimePolicies: createRuntimePolicyAccumulator(),
    };
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
  const runtimePolicies = createRuntimePolicyAccumulator();
  let pluginBindingCount = 0;
  for (const pluginId of [...pluginIds].sort()) {
    const parsedPluginId = parsePluginId(pluginId);
    const knownMarketplace = asRecord(knownMarketplaces[parsedPluginId.marketplaceId ?? ""]);
    const installedRecords = asRecordArray(installedByPlugin[pluginId]);
    const existingPlugin = args.existingCapabilities.pluginsByName.get(parsedPluginId.name);
    const canonicalPluginId = existingPlugin?.id ?? `plugin.${parsedPluginId.name}`;
    const pluginAssetPath = await ensurePluginAssetRoot(args.repoRoot, canonicalPluginId, parsedPluginId.name, {
      sourceLabel: "Seeded from local plugin configuration",
      runtimeId: "claude",
      existingCapability: existingPlugin,
    });
    const localSourceDir = await resolveClaudePluginDirectory({
      homeDir: args.homeDir,
      installedRecords,
      knownMarketplace,
      marketplaceId: parsedPluginId.marketplaceId,
    });
    const artifactName = buildPluginArtifactName("claude", parsedPluginId.name);
    const relativeSourcePath = path.join(pluginAssetPath, "targets", "claude");
    const install =
      localSourceDir && (await pathExists(path.join(localSourceDir, ".claude-plugin", "plugin.json")))
        ? await buildCopiedInstall(args.repoRoot, relativeSourcePath, localSourceDir, {
            artifactName,
            seededFrom: "claude-plugin-marketplace",
            pluginId,
            localPath: localSourceDir,
          })
        : {
            strategy: "external" as const,
            artifactName,
            manifest: {
              seededFrom: "claude-settings",
              pluginId,
              marketplaceId: parsedPluginId.marketplaceId,
            },
          };
    const bindingId =
      parsedPluginId.marketplaceId
        ? "marketplace"
        : install.strategy === "external"
          ? "external"
          : "package";

    capabilities.push(
      buildSeededCapability({
        assetKind: "plugin",
        bindings: {
          [bindingId]: {
            plugin: {
              install,
              nativeRegistration: {
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
        },
        canonicalPath: pluginAssetPath,
        digest: await computeDirectoryDigest(path.join(args.repoRoot, pluginAssetPath)),
        id: canonicalPluginId,
        install: {
          strategy: "copy",
          artifactName: parsedPluginId.name,
          sourcePath: pluginAssetPath,
        },
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
          notes: ["Seeded from the local Claude plugin configuration."],
        },
        riskTier: "T2",
        tags: [BOOTSTRAP_IMPORT_TAG, "plugin-import"],
        repoSource: args.repoSource,
      })
    );
    noteRuntimeSelection(runtimePolicies, "claude", canonicalPluginId, bindingId);
    pluginBindingCount += 1;
  }

  return {
    capabilities,
    pluginBindingCount,
    runtimePolicies,
  };
}

function buildSeededCapability(
  input: SeededCapabilityInput & {
    repoSource: RepoSource;
  }
) {
  return capabilitySchema.parse({
    id: input.id,
    name: input.name,
    assetKind: input.assetKind,
    bindings: input.bindings,
    discoverySources: [],
    includes: input.includes ?? [],
    ...(input.entrypoints ? { entrypoints: input.entrypoints } : {}),
    exposes: input.exposes ?? [],
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
  repoSource: RepoSource;
  reviewTimestamp: string;
  reviewer: string;
  runtimeId: string;
  sanitizedConfig: unknown;
  serverName: string;
  tags: string[];
}) {
  const bindingId = bindingIdForMcpConfig(args.sanitizedConfig);
  return buildSeededCapability({
    assetKind: "mcp",
    bindings: {
      [bindingId]: {
        mcp: {
          serverName: args.serverName,
          config: asRecord(args.sanitizedConfig),
        },
      },
    },
    canonicalPath: registryCapabilityPathFromId(args.id),
    digest: computeValueDigest({
      serverName: args.serverName,
      bindingId,
      binding: {
        mcp: {
          serverName: args.serverName,
          config: asRecord(args.sanitizedConfig),
        },
      },
    }),
    id: args.id,
    install: {
      strategy: "manifest",
      artifactName: args.serverName,
      manifest: {
        seededFrom: args.configPath,
      },
    },
    name: args.serverName,
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
      notes: [`Seeded from ${args.runtimeId} runtime MCP configuration.`],
    },
    riskTier: args.hasSecrets ? "T3" : "T2",
    tags: args.tags,
    repoSource: args.repoSource,
  });
}

async function removePreviousBootstrapSeededArtifacts(root: string) {
  const ownedAssetPaths = new Set<string>();
  const capabilityFiles = await listFiles(path.join(root, "registry", "capabilities"), ".yaml");
  for (const filePath of capabilityFiles) {
    const parsed = capabilitySchema.parse(await readYamlFile(filePath));
    if (!parsed.tags.includes(BOOTSTRAP_IMPORT_TAG)) {
      continue;
    }
    collectBootstrapOwnedAssetPaths(root, ownedAssetPaths, parsed.install.sourcePath);
    collectBootstrapOwnedAssetPaths(root, ownedAssetPaths, parsed.canonicalSource.path);
    await removePath(filePath);
  }

  for (const assetPath of [...ownedAssetPaths].sort((left, right) => right.length - left.length)) {
    await removePath(assetPath);
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
    notes: ["Canonical source for bootstrap-seeded local artifacts."],
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

function buildExistingCapabilityIndex(capabilities: CapabilityRecord[]): ExistingCapabilityIndex {
  const byId = new Map<string, CapabilityRecord>();
  const mcpsByName = new Map<string, CapabilityRecord>();
  const pluginsByName = new Map<string, CapabilityRecord>();
  const skillsByName = new Map<string, CapabilityRecord>();

  for (const capability of capabilities) {
    byId.set(capability.id, capability);
    if (capability.assetKind === "mcp") {
      mcpsByName.set(capability.name, capability);
    }
    if (capability.assetKind === "plugin") {
      pluginsByName.set(capability.name, capability);
    }
    if (capability.assetKind === "skill") {
      skillsByName.set(capability.name, capability);
    }
  }

  return {
    byId,
    mcpsByName,
    pluginsByName,
    skillsByName,
  };
}

function createRuntimePolicyAccumulator(): RuntimePolicyAccumulator {
  return new Map();
}

function noteRuntimeSelection(
  runtimePolicies: RuntimePolicyAccumulator,
  runtimeId: string,
  capabilityId: string,
  bindingId?: string
) {
  const entry = getOrCreateRuntimePolicy(runtimePolicies, runtimeId);
  entry.enabledCapabilityIds.add(capabilityId);
  if (bindingId) {
    entry.overrides.set(capabilityId, bindingId);
  }
}

function mergeRuntimePolicies(target: RuntimePolicyAccumulator, source: RuntimePolicyAccumulator) {
  for (const [runtimeId, policy] of source) {
    const targetEntry = getOrCreateRuntimePolicy(target, runtimeId);
    for (const capabilityId of policy.enabledCapabilityIds) {
      targetEntry.enabledCapabilityIds.add(capabilityId);
    }
    for (const [capabilityId, bindingId] of policy.overrides) {
      targetEntry.overrides.set(capabilityId, bindingId);
    }
  }
}

function getOrCreateRuntimePolicy(runtimePolicies: RuntimePolicyAccumulator, runtimeId: string) {
  const existing = runtimePolicies.get(runtimeId);
  if (existing) {
    return existing;
  }

  const next = {
    enabledCapabilityIds: new Set<string>(),
    overrides: new Map<string, string | "disabled">(),
  };
  runtimePolicies.set(runtimeId, next);
  return next;
}

async function applyRuntimePolicies(root: string, runtimePolicies: RuntimePolicyAccumulator) {
  for (const [runtimeId, policy] of [...runtimePolicies.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const runtimePath = path.join(root, "runtimes", `${runtimeId}.yaml`);
    if (!(await pathExists(runtimePath))) {
      continue;
    }

    const runtime = runtimeSchema.parse(await readYamlFile(runtimePath));
    runtime.enabledCapabilities = [
      ...new Set([...runtime.enabledCapabilities, ...policy.enabledCapabilityIds]),
    ].sort();
    runtime.bindingPolicy = {
      ...runtime.bindingPolicy,
      overrides: {
        ...runtime.bindingPolicy.overrides,
        ...Object.fromEntries([...policy.overrides.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        )),
      },
    };
    await writeYamlFile(runtimePath, runtime);
  }
}

function seedAndMergeCapability(
  seededCapabilities: Map<string, CapabilityRecord>,
  existingCapabilities: ExistingCapabilityIndex,
  capability: CapabilityRecord
) {
  if (!seededCapabilities.has(capability.id)) {
    const existing = existingCapabilities.byId.get(capability.id);
    if (existing && capability.assetKind === "mcp") {
      seededCapabilities.set(capability.id, existing);
    }
  }
  mergeSeededCapability(seededCapabilities, capability);
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
          managedPluginIds: runtimeState.plugins.map((plugin) => plugin.nativeRegistration.pluginId),
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
          managedEnabledPluginIds: runtimeState.plugins.map((plugin) => plugin.nativeRegistration.pluginId),
          managedMarketplaceIds: runtimeState.plugins
            .map((plugin) => plugin.nativeRegistration.knownMarketplace?.marketplaceId)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
          managedInstalledPluginIds: runtimeState.plugins
            .filter((plugin) => plugin.nativeRegistration.installedRecords.length > 0)
            .map((plugin) => plugin.nativeRegistration.pluginId),
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
  manifest: Record<string, unknown> & {
    artifactName?: string;
  }
) {
  const targetPath = path.join(root, relativeSourcePath);
  await copySeededDirectory(sourceDir, targetPath);
  const { artifactName, ...manifestPayload } = manifest;
  return {
    strategy: "copy" as const,
    artifactName: artifactName ?? path.basename(relativeSourcePath),
    sourcePath: normalizePosix(relativeSourcePath),
    manifest: manifestPayload,
  };
}

async function ensurePluginAssetRoot(
  root: string,
  capabilityId: string,
  pluginName: string,
  args: {
    existingCapability: CapabilityRecord | undefined;
    runtimeId: string;
    sourceLabel: string;
  }
) {
  const relativePath = resolvePluginAssetPath(args.existingCapability, pluginName);
  const targetDir = path.join(root, relativePath);
  await ensureDir(targetDir);
  const readmePath = path.join(targetDir, "README.md");
  if (!(await pathExists(readmePath))) {
    await writeText(
      readmePath,
      [
        `# ${pluginName}`,
        "",
        "Canonical plugin asset managed by agent-governance.",
        "",
        `- Canonical capability lives in \`${registryCapabilityPathFromId(capabilityId)}\``,
        `- Runtime seed: ${args.runtimeId}`,
        `- Initial seed: ${args.sourceLabel}`,
        "",
        "Runtime-specific installation payloads live under targets/<runtime>/.",
        "",
      ].join("\n")
    );
  }
  return relativePath;
}

function resolvePluginAssetPath(existingCapability: CapabilityRecord | undefined, pluginName: string) {
  for (const candidate of [
    existingCapability?.install.sourcePath,
    existingCapability?.canonicalSource.path,
  ]) {
    if (candidate && !path.isAbsolute(candidate) && normalizePosix(candidate).startsWith("assets/plugins/")) {
      return normalizePosix(candidate);
    }
  }

  return normalizePosix(path.join("assets", "plugins", pluginName));
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

function registryCapabilityPathFromId(id: string) {
  const [kind, ...rest] = id.split(".");
  const name = rest.at(-1);
  if (!kind || !name) {
    throw new Error(`Invalid capability id ${id}.`);
  }
  return normalizePosix(path.join("registry", "capabilities", kind, ...rest.slice(0, -1), `${name}.yaml`));
}

function bindingIdForMcpConfig(config: unknown) {
  const record = asRecord(config);
  return typeof record.url === "string" ? "remote-http" : "stdio-command";
}

function collectBootstrapOwnedAssetPaths(
  root: string,
  ownedAssetPaths: Set<string>,
  sourcePath: string | undefined
) {
  if (!sourcePath || path.isAbsolute(sourcePath)) {
    return;
  }

  const normalized = normalizePosix(sourcePath);
  if (!(normalized.startsWith("assets/") || normalized.startsWith("vendor/bootstrap-seeded/"))) {
    return;
  }

  ownedAssetPaths.add(path.join(root, normalized));
}

function mergeSeededCapability(
  seededCapabilities: Map<string, CapabilityRecord>,
  capability: CapabilityRecord
) {
  const existing = seededCapabilities.get(capability.id);
  if (!existing) {
    seededCapabilities.set(capability.id, capability);
    return;
  }

  const merged = capabilitySchema.parse({
    ...existing,
    bindings: {
      ...existing.bindings,
      ...capability.bindings,
    },
    includes: [...new Set([...existing.includes, ...capability.includes])].sort(),
    entrypoints: {
      commands: [
        ...new Set([
          ...(existing.entrypoints?.commands ?? []),
          ...(capability.entrypoints?.commands ?? []),
        ]),
      ].sort(),
      agents: [
        ...new Set([
          ...(existing.entrypoints?.agents ?? []),
          ...(capability.entrypoints?.agents ?? []),
        ]),
      ].sort(),
    },
    exposes: [...new Set([...existing.exposes, ...capability.exposes])].sort(),
    permissions: {
      localRead: maxLocalRead(existing.permissions.localRead, capability.permissions.localRead),
      network: existing.permissions.network || capability.permissions.network,
      credentials: existing.permissions.credentials || capability.permissions.credentials,
      filesystemWrite: maxFilesystemWrite(
        existing.permissions.filesystemWrite,
        capability.permissions.filesystemWrite
      ),
    },
    review: {
      ...existing.review,
      reviewer: existing.review.reviewer ?? capability.review.reviewer,
      reviewedAt: maxReviewedAt(existing.review.reviewedAt, capability.review.reviewedAt),
      license: existing.review.license ?? capability.review.license,
      status: existing.review.status === "approved" || capability.review.status === "approved"
        ? "approved"
        : existing.review.status,
      executesScripts:
        (existing.review.executesScripts ?? false) || (capability.review.executesScripts ?? false),
      networkAccess:
        (existing.review.networkAccess ?? false) || (capability.review.networkAccess ?? false),
      touchesCredentials:
        (existing.review.touchesCredentials ?? false) ||
        (capability.review.touchesCredentials ?? false),
      filesystemSideEffects:
        existing.review.filesystemSideEffects ?? capability.review.filesystemSideEffects,
      notes: [...new Set([...existing.review.notes, ...capability.review.notes])],
    },
    riskTier: maxRiskTier(existing.riskTier, capability.riskTier),
    tags: [...new Set([...existing.tags, ...capability.tags])].sort(),
    hash:
      existing.assetKind === "mcp"
        ? {
            algorithm: "sha256",
            digest: computeValueDigest({
              install: existing.install,
              bindings: {
                ...existing.bindings,
                ...capability.bindings,
              },
            }),
          }
        : existing.hash,
  });

  seededCapabilities.set(capability.id, merged);
}

function maxRiskTier(left: CapabilityRecord["riskTier"], right: CapabilityRecord["riskTier"]) {
  const order: CapabilityRecord["riskTier"][] = ["T0", "T1", "T2", "T3"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))]!;
}

function maxLocalRead(
  left: CapabilityRecord["permissions"]["localRead"],
  right: CapabilityRecord["permissions"]["localRead"]
) {
  const order: CapabilityRecord["permissions"]["localRead"][] = ["none", "scoped", "full"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))]!;
}

function maxFilesystemWrite(
  left: CapabilityRecord["permissions"]["filesystemWrite"],
  right: CapabilityRecord["permissions"]["filesystemWrite"]
) {
  const order: CapabilityRecord["permissions"]["filesystemWrite"][] = [
    "none",
    "runtime-only",
    "full",
  ];
  return order[Math.max(order.indexOf(left), order.indexOf(right))]!;
}

function maxReviewedAt(left?: string, right?: string) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
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

async function copySeededDirectory(sourceDir: string, targetDir: string) {
  await copyDirectoryResolved(sourceDir, targetDir);
}
