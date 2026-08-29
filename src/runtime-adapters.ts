import path from "node:path";
import TOML from "@iarna/toml";
import type { RenderedRuntimeState } from "./schema.js";
import {
  computeDirectoryDigest,
  copyDirectory,
  copyFile,
  ensureDir,
  listTopLevelEntries,
  pathExists,
  readJsonFile,
  readText,
  removePath,
  writeJsonFile,
  writeText,
} from "./io.js";

// Runtime adapters own the final merge into native config files.
// They protect unmanaged user state by tracking previously governed keys and refusing collisions.

type CacheState = {
  managedPaths: string[];
};

type CodexState = {
  managedSkillIds: string[];
  managedSkillPaths: string[];
  managedPluginIds: string[];
  managedMcpServerNames: string[];
};

type ManagedFileState = {
  managed: boolean;
  sourceDigest?: string;
};

type CodexProjectTrustState = {
  managedProjectScopes: string[];
};

type CursorState = {
  managedSkillIds: string[];
  managedMcpServerNames: string[];
};

type ClaudeState = {
  managedEnabledPluginIds: string[];
  managedMarketplaceIds: string[];
  managedInstalledPluginIds: string[];
};

export async function syncSharedArtifactCache(
  generatedSharedCacheDir: string,
  cacheRoot: string,
  stateFile: string
) {
  const previous = await readOptionalJson<CacheState>(stateFile, { managedPaths: [] });
  const desired = await collectManagedPaths(generatedSharedCacheDir);
  const previousSet = new Set(previous.managedPaths);

  for (const relativePath of desired) {
    const sourcePath = path.join(generatedSharedCacheDir, relativePath);
    const targetPath = path.join(cacheRoot, relativePath);

    if (
      (await pathExists(targetPath)) &&
      !previousSet.has(relativePath) &&
      !(await canAdoptUnmanagedCacheEntry(sourcePath, targetPath))
    ) {
      throw new Error(`Shared cache collision at ${targetPath}.`);
    }

    await copyEntry(sourcePath, targetPath);
  }

  const desiredSet = new Set(desired);
  for (const previousPath of previous.managedPaths) {
    if (!desiredSet.has(previousPath)) {
      await removePath(path.join(cacheRoot, previousPath));
    }
  }

  await writeJsonFile(stateFile, {
    managedPaths: desired,
  });
}

export async function syncCodexRuntime(runtimeState: RenderedRuntimeState) {
  const configPath = requiredPath(runtimeState.nativeFiles.config, "codex config");
  const statePath = runtimeState.ownedStateFile;
  const existingText = (await pathExists(configPath)) ? await readText(configPath) : "";
  const parsed: TOML.JsonMap = existingText.trim()
    ? (TOML.parse(existingText) as TOML.JsonMap)
    : {};

  const state = await readOptionalJson<CodexState>(statePath, {
    managedSkillIds: [],
    managedSkillPaths: [],
    managedPluginIds: [],
    managedMcpServerNames: [],
  });
  const previousManagedSkillIds = state.managedSkillIds ?? [];
  const previousManagedSkillPaths = state.managedSkillPaths ?? [];
  const userSkillsDir = runtimeState.nativeFiles.userSkillsDir;
  if (userSkillsDir) {
    await syncManagedSkillDirectory(
      userSkillsDir,
      runtimeState.cacheBindings.skillsDir,
      runtimeState.skills.filter((skill) => skill.syncMode === "user-skill-dir"),
      previousManagedSkillIds,
      "Codex skill"
    );
    const legacyUserSkillsDir = path.join(path.dirname(configPath), "skills");
    if (path.resolve(legacyUserSkillsDir) !== path.resolve(userSkillsDir)) {
      for (const previousSkillId of previousManagedSkillIds) {
        await removePath(path.join(legacyUserSkillsDir, previousSkillId));
      }
    }
  } else if (previousManagedSkillIds.length > 0) {
    const legacyUserSkillsDir = path.join(path.dirname(configPath), "skills");
    await syncManagedSkillDirectory(
      legacyUserSkillsDir,
      runtimeState.cacheBindings.skillsDir,
      [],
      previousManagedSkillIds,
      "Codex legacy skill"
    );
  }

  const desiredSkillPaths = runtimeState.skills
    .filter((skill) => skill.syncMode === "config-path")
    .map((skill) => path.join(requiredPath(runtimeState.cacheBindings.skillsDir, "Codex skill cache"), skill.artifactName));
  const skillsSection = ensureRecord(parsed, "skills");
  const existingSkillConfig = Array.isArray(skillsSection.config)
    ? skillsSection.config.filter((entry): entry is TOML.JsonMap => Boolean(entry) && typeof entry === "object")
    : [];
  const previousPathSet = new Set(previousManagedSkillPaths);
  const unmanagedSkillConfig = existingSkillConfig.filter((entry) => {
    const configuredPath = typeof entry.path === "string" ? entry.path : null;
    return !configuredPath || !previousPathSet.has(configuredPath);
  });
  const unmanagedPathSet = new Set(
    unmanagedSkillConfig
      .map((entry) => (typeof entry.path === "string" ? entry.path : null))
      .filter((value): value is string => Boolean(value))
  );
  for (const skillPath of desiredSkillPaths) {
    if (!(await pathExists(skillPath))) {
      throw new Error(`Configured Codex skill is missing at ${skillPath}.`);
    }
    if (unmanagedPathSet.has(skillPath)) {
      continue;
    }
    unmanagedSkillConfig.push({ path: skillPath, enabled: true });
  }
  if (unmanagedSkillConfig.length > 0) {
    skillsSection.config = unmanagedSkillConfig;
  } else {
    delete skillsSection.config;
  }

  const managedPluginIds = new Set(state.managedPluginIds);
  const managedMcpServerNames = new Set(state.managedMcpServerNames);

  const pluginsSection = ensureRecord(parsed, "plugins");
  for (const plugin of runtimeState.plugins) {
    assertUnmanagedCollision(pluginsSection, plugin.nativeRegistration.pluginId, managedPluginIds, "Codex plugin", {
      allowAdopt: plugin.nativeRegistration.adoptExisting,
    });
  }
  for (const pluginId of state.managedPluginIds) {
    delete pluginsSection[pluginId];
  }
  for (const plugin of runtimeState.plugins) {
    pluginsSection[plugin.nativeRegistration.pluginId] = {
      enabled: plugin.nativeRegistration.enabled,
    };
  }

  const mcpSection = ensureRecord(parsed, "mcp_servers");
  for (const mcp of runtimeState.mcps) {
    assertUnmanagedCollision(mcpSection, mcp.serverName, managedMcpServerNames, "Codex MCP server", {
      allowAdopt: mcp.adoptExisting,
    });
  }
  for (const serverName of state.managedMcpServerNames) {
    delete mcpSection[serverName];
  }
  for (const mcp of runtimeState.mcps) {
    mcpSection[mcp.serverName] = mcp.config as unknown as TOML.AnyJson;
  }

  removeEmptyRecord(parsed, "skills");
  removeEmptyRecord(parsed, "plugins");
  removeEmptyRecord(parsed, "mcp_servers");

  await writeText(configPath, TOML.stringify(parsed));
  await writeJsonFile(statePath, {
    managedSkillIds: userSkillsDir
      ? runtimeState.skills
          .filter((skill) => skill.syncMode === "user-skill-dir")
          .map((skill) => skill.artifactName)
      : [],
    managedSkillPaths: desiredSkillPaths,
    managedPluginIds: runtimeState.plugins.map((plugin) => plugin.nativeRegistration.pluginId),
    managedMcpServerNames: runtimeState.mcps.map((mcp) => mcp.serverName),
  });
}

export async function syncCodexGlobalAgents(
  sourcePath: string,
  targetPath: string,
  statePath: string
) {
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Missing versioned Codex global AGENTS source at ${sourcePath}.`);
  }

  const sourceDigest = await computeDirectoryDigest(sourcePath);
  const previous = await readOptionalJson<ManagedFileState>(statePath, { managed: false });

  if (
    (await pathExists(targetPath)) &&
    !previous.managed &&
    (await computeDirectoryDigest(targetPath)) !== sourceDigest
  ) {
    throw new Error(`Codex global AGENTS collision at ${targetPath}.`);
  }

  await copyFile(sourcePath, targetPath);
  await writeJsonFile(statePath, {
    managed: true,
    sourceDigest,
  });
}

export async function syncCodexProjectTrust(
  configPath: string,
  statePath: string,
  desiredProjectScopes: string[]
) {
  const existingText = (await pathExists(configPath)) ? await readText(configPath) : "";
  const parsed: TOML.JsonMap = existingText.trim()
    ? (TOML.parse(existingText) as TOML.JsonMap)
    : {};
  const previous = await readOptionalJson<CodexProjectTrustState>(statePath, {
    managedProjectScopes: [],
  });
  const previouslyManaged = new Set(previous.managedProjectScopes);
  const desired = [...new Set(desiredProjectScopes)].sort();
  const desiredSet = new Set(desired);
  const projects = ensureRecord(parsed, "projects");
  const managedProjectScopes: string[] = [];

  for (const projectScope of desired) {
    const existing = projects[projectScope];
    const project = existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
    const isAlreadyTrusted = project.trust_level === "trusted";
    if (!isAlreadyTrusted || previouslyManaged.has(projectScope)) {
      project.trust_level = "trusted";
      managedProjectScopes.push(projectScope);
    }
    projects[projectScope] = project as TOML.AnyJson;
  }

  for (const projectScope of previous.managedProjectScopes) {
    if (desiredSet.has(projectScope)) {
      continue;
    }
    const project = projects[projectScope];
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      continue;
    }
    if ((project as Record<string, unknown>).trust_level === "trusted") {
      delete (project as Record<string, unknown>).trust_level;
    }
    if (Object.keys(project).length === 0) {
      delete projects[projectScope];
    }
  }

  removeEmptyRecord(parsed, "projects");
  await writeText(configPath, TOML.stringify(parsed));
  await writeJsonFile(statePath, { managedProjectScopes });
}

export async function syncCursorRuntime(runtimeState: RenderedRuntimeState) {
  const mcpConfigPath = requiredPath(runtimeState.nativeFiles.mcpConfig, "cursor mcp config");
  const userSkillsDir = requiredPath(runtimeState.nativeFiles.userSkillsDir, "cursor user skills dir");
  const userSkillsManifest = requiredPath(
    runtimeState.nativeFiles.userSkillsManifest,
    "cursor user skills manifest"
  );
  const statePath = runtimeState.ownedStateFile;

  const state = await readOptionalJson<CursorState>(statePath, {
    managedSkillIds: [],
    managedMcpServerNames: [],
  });
  const managedMcpServerNames = new Set(state.managedMcpServerNames);

  await syncManagedSkillDirectory(
    userSkillsDir,
    runtimeState.cacheBindings.skillsDir,
    runtimeState.skills.filter((skill) => skill.syncMode === "user-skill-dir"),
    state.managedSkillIds,
    "Cursor skill"
  );

  await writeJsonFile(userSkillsManifest, {
    managedSkillIds: runtimeState.skills
      .filter((skill) => skill.syncMode === "user-skill-dir")
      .map((skill) => skill.artifactName),
  });

  const existingMcpConfig = (await pathExists(mcpConfigPath))
    ? await readJsonFile<Record<string, unknown>>(mcpConfigPath)
    : {};
  const mcpServers = ensureRecord(existingMcpConfig, "mcpServers");
  for (const mcp of runtimeState.mcps) {
    assertUnmanagedCollision(mcpServers, mcp.serverName, managedMcpServerNames, "Cursor MCP server");
  }
  for (const serverName of state.managedMcpServerNames) {
    delete mcpServers[serverName];
  }
  for (const mcp of runtimeState.mcps) {
    mcpServers[mcp.serverName] = mcp.config;
  }

  await writeJsonFile(mcpConfigPath, existingMcpConfig);
  await writeJsonFile(statePath, {
    managedSkillIds: runtimeState.skills
      .filter((skill) => skill.syncMode === "user-skill-dir")
      .map((skill) => skill.artifactName),
    managedMcpServerNames: runtimeState.mcps.map((mcp) => mcp.serverName),
  });
}

export async function syncClaudeRuntime(runtimeState: RenderedRuntimeState) {
  const settingsPath = requiredPath(runtimeState.nativeFiles.settings, "claude settings");
  const knownMarketplacesPath = requiredPath(
    runtimeState.nativeFiles.knownMarketplaces,
    "claude known marketplaces"
  );
  const installedPluginsPath = requiredPath(
    runtimeState.nativeFiles.installedPlugins,
    "claude installed plugins"
  );
  const statePath = runtimeState.ownedStateFile;
  const state = await readOptionalJson<ClaudeState>(statePath, {
    managedEnabledPluginIds: [],
    managedMarketplaceIds: [],
    managedInstalledPluginIds: [],
  });
  const managedEnabledPluginIds = new Set(state.managedEnabledPluginIds);
  const managedMarketplaceIds = new Set(state.managedMarketplaceIds);
  const managedInstalledPluginIds = new Set(state.managedInstalledPluginIds);

  const settings = (await pathExists(settingsPath))
    ? await readJsonFile<Record<string, unknown>>(settingsPath)
    : {};
  const enabledPlugins = ensureRecord(settings, "enabledPlugins");
  for (const plugin of runtimeState.plugins) {
    assertUnmanagedCollision(
      enabledPlugins,
      plugin.nativeRegistration.pluginId,
      managedEnabledPluginIds,
      "Claude enabled plugin"
    );
  }
  for (const pluginId of state.managedEnabledPluginIds) {
    delete enabledPlugins[pluginId];
  }
  for (const plugin of runtimeState.plugins) {
    enabledPlugins[plugin.nativeRegistration.pluginId] = plugin.nativeRegistration.enabled;
  }

  const knownMarketplaces = (await pathExists(knownMarketplacesPath))
    ? await readJsonFile<Record<string, unknown>>(knownMarketplacesPath)
    : {};
  for (const plugin of runtimeState.plugins) {
    const marketplaceId = asString(plugin.nativeRegistration.knownMarketplace?.marketplaceId);
    if (marketplaceId) {
      assertUnmanagedCollision(
        knownMarketplaces,
        marketplaceId,
        managedMarketplaceIds,
        "Claude marketplace"
      );
    }
  }
  for (const marketplaceId of state.managedMarketplaceIds) {
    delete knownMarketplaces[marketplaceId];
  }
  for (const plugin of runtimeState.plugins) {
    const marketplaceId = asString(plugin.nativeRegistration.knownMarketplace?.marketplaceId);
    if (marketplaceId && plugin.nativeRegistration.knownMarketplace) {
      knownMarketplaces[marketplaceId] = stripMarketplaceId(plugin.nativeRegistration.knownMarketplace);
    }
  }

  const installedPlugins = (await pathExists(installedPluginsPath))
    ? await readJsonFile<Record<string, unknown>>(installedPluginsPath)
    : { version: 2, plugins: {} };
  const pluginsSection = ensureRecord(installedPlugins, "plugins");
  for (const plugin of runtimeState.plugins) {
    if (plugin.nativeRegistration.installedRecords.length > 0) {
      assertUnmanagedCollision(
        pluginsSection,
        plugin.nativeRegistration.pluginId,
        managedInstalledPluginIds,
        "Claude installed plugin"
      );
    }
  }
  for (const pluginId of state.managedInstalledPluginIds) {
    delete pluginsSection[pluginId];
  }
  for (const plugin of runtimeState.plugins) {
    if (plugin.nativeRegistration.installedRecords.length > 0) {
      pluginsSection[plugin.nativeRegistration.pluginId] = plugin.nativeRegistration.installedRecords;
    }
  }

  await writeJsonFile(settingsPath, settings);
  await writeJsonFile(knownMarketplacesPath, knownMarketplaces);
  await writeJsonFile(installedPluginsPath, installedPlugins);
  await writeJsonFile(statePath, {
    managedEnabledPluginIds: runtimeState.plugins.map((plugin) => plugin.nativeRegistration.pluginId),
    managedMarketplaceIds: runtimeState.plugins
      .map((plugin) => asString(plugin.nativeRegistration.knownMarketplace?.marketplaceId))
      .filter((value): value is string => Boolean(value)),
    managedInstalledPluginIds: runtimeState.plugins
      .filter((plugin) => plugin.nativeRegistration.installedRecords.length > 0)
      .map((plugin) => plugin.nativeRegistration.pluginId),
  });
}

async function syncManagedSkillDirectory(
  targetRoot: string,
  cacheSkillsDir: string | undefined,
  desiredSkills: RenderedRuntimeState["skills"],
  previousManagedSkillIds: string[],
  label: string
) {
  if (!cacheSkillsDir) {
    throw new Error("Cursor runtime is missing cacheBindings.skillsDir.");
  }

  await ensureDir(targetRoot);
  const previousSet = new Set(previousManagedSkillIds);
  const desiredSet = new Set(desiredSkills.map((skill) => skill.artifactName));

  for (const skill of desiredSkills) {
    const sourcePath = path.join(cacheSkillsDir, skill.artifactName);
    const targetPath = path.join(targetRoot, skill.artifactName);

    if (!(await pathExists(sourcePath))) {
      throw new Error(`Shared cache skill missing at ${sourcePath}.`);
    }
    if (
      (await pathExists(targetPath)) &&
      !previousSet.has(skill.artifactName) &&
      !(await canAdoptUnmanagedCacheEntry(sourcePath, targetPath))
    ) {
      throw new Error(`${label} collision at ${targetPath}.`);
    }

    await removePath(targetPath);
    await copyDirectory(sourcePath, targetPath);
  }

  for (const previousSkillId of previousManagedSkillIds) {
    if (!desiredSet.has(previousSkillId)) {
      await removePath(path.join(targetRoot, previousSkillId));
    }
  }
}

async function collectManagedPaths(rootDir: string) {
  const entries = await listTopLevelEntries(rootDir);
  const managed: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "directory") {
      const innerEntries = await listTopLevelEntries(entry.path);
      for (const innerEntry of innerEntries) {
        managed.push(path.join(entry.name, innerEntry.name));
      }
      continue;
    }

    managed.push(entry.name);
  }

  return managed.sort();
}

async function canAdoptUnmanagedCacheEntry(sourcePath: string, targetPath: string) {
  const sourceStat = await pathStat(sourcePath);
  const targetStat = await pathStat(targetPath);

  if (!sourceStat || !targetStat || sourceStat !== targetStat) {
    return false;
  }

  if (targetStat === "directory") {
    const existingEntries = await listTopLevelEntries(targetPath);
    if (existingEntries.length === 0) {
      return true;
    }
  }

  const [sourceDigest, targetDigest] = await Promise.all([
    computeDirectoryDigest(sourcePath),
    computeDirectoryDigest(targetPath),
  ]);
  return sourceDigest === targetDigest;
}

async function copyEntry(sourcePath: string, targetPath: string) {
  const stat = await pathStat(sourcePath);
  if (!stat) {
    throw new Error(`Missing generated artifact ${sourcePath}.`);
  }

  await removePath(targetPath);
  if (stat === "directory") {
    await copyDirectory(sourcePath, targetPath);
    return;
  }

  await copyFile(sourcePath, targetPath);
}

async function pathStat(targetPath: string) {
  if (!(await pathExists(targetPath))) {
    return null;
  }
  const stat = await (await import("node:fs")).promises.stat(targetPath);
  return stat.isDirectory() ? "directory" : "file";
}

async function readOptionalJson<T>(filePath: string, fallback: T) {
  return (await pathExists(filePath)) ? readJsonFile<T>(filePath) : fallback;
}

function ensureRecord(container: Record<string, unknown>, key: string) {
  const existing = container[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }

  const record: Record<string, unknown> = {};
  container[key] = record;
  return record;
}

function removeEmptyRecord(container: Record<string, unknown>, key: string) {
  const value = container[key];
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    delete container[key];
  }
}

function requiredPath(value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`Missing required runtime path for ${label}.`);
  }
  return value;
}

function assertUnmanagedCollision(
  record: Record<string, unknown>,
  key: string,
  managedKeys: Set<string>,
  label: string,
  options: { allowAdopt?: boolean } = {}
) {
  if (key in record && !managedKeys.has(key) && !options.allowAdopt) {
    throw new Error(`${label} collision at ${key}. Existing entry is not governed by agent-governance.`);
  }
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stripMarketplaceId(value: Record<string, unknown>) {
  const { marketplaceId: _marketplaceId, ...rest } = value;
  return rest;
}
