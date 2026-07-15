import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { loadRepo } from "./governance.js";
import type { BootstrapRecord, MachineRecord, RenderedRuntimeState, RuntimeAuditSnapshot, RuntimeRecord } from "./schema.js";
import { renderedRuntimeStateSchema, runtimeAuditSnapshotSchema } from "./schema.js";
import { ensureDir, listTopLevelEntries, pathExists, readJsonFile, readText, writeJsonFile } from "./io.js";

const HIGH_RISK_PLUGIN_IDS = new Set([
  "build-web-apps@openai-curated",
  "superpowers@openai-curated",
]);
const ALLOWED_UNMANAGED_PLUGIN_IDS = new Set([
  "browser@openai-bundled",
  "chrome@openai-bundled",
  "computer-use@openai-bundled",
  "documents@openai-primary-runtime",
  "github@openai-curated",
  "google-drive@openai-curated",
  "pdf@openai-primary-runtime",
  "presentations@openai-primary-runtime",
  "sites@openai-bundled",
  "slack@openai-curated",
  "spreadsheets@openai-primary-runtime",
  "template-creator@openai-primary-runtime",
  "visualize@openai-bundled",
]);
const ALLOWED_UNMANAGED_MCP_SERVER_NAMES = new Set(["computer-use", "node_repl"]);
const ALLOWED_UNMANAGED_USER_SKILLS = new Set([
  "hatch-pet",
  "sample-watermark",
]);

export async function auditRuntimeTruth(options: {
  root: string;
  bootstrap: BootstrapRecord;
  machineId?: string;
  runtimeId: string;
  write?: boolean;
}) {
  if (options.runtimeId !== "codex") {
    throw new Error(`Runtime truth audit currently supports codex only, got ${options.runtimeId}.`);
  }

  const repo = await loadRepo(options.root);
  const machine = repo.machines.get(options.machineId ?? options.bootstrap.machineId);
  if (!machine) {
    throw new Error(`Unknown machine ${options.machineId ?? options.bootstrap.machineId}.`);
  }
  const runtime = repo.runtimes.get(options.runtimeId);
  if (!runtime) {
    throw new Error(`Unknown runtime ${options.runtimeId}.`);
  }

  const vars = buildPathVars(options.bootstrap, machine);
  const configPath = runtimeNativePath(runtime, machine, vars, "config")!;
  const desired = await readDesiredState(options.root, machine.machineId, runtime.runtimeId);
  const nativeUserSkillsDir = runtimeNativePath(runtime, machine, vars, "userSkillsDir", false);
  const userSkillsDir: string =
    nativeUserSkillsDir ?? desired.cacheBindings.skillsDir ?? path.join(vars.HOME, ".agents", "skills");
  const pluginCacheDir = path.join(vars.HOME, ".codex", "plugins", "cache");

  const actualPlugins = await readCodexPlugins(configPath);
  const snapshot = runtimeAuditSnapshotSchema.parse({
    machineId: machine.machineId,
    runtimeId: runtime.runtimeId,
    generatedAt: new Date().toISOString(),
    actual: {
      configPath,
      userSkillsDir,
      pluginCacheDir,
      plugins: actualPlugins,
      mcpServers: await readCodexMcpServerNames(configPath),
      userSkills: await readSkillDirNames(userSkillsDir),
      pluginSkills: await readPluginSkillRoots(pluginCacheDir),
    },
    desired: {
      plugins: Object.fromEntries(
        desired.plugins.map((plugin) => [
          plugin.nativeRegistration.pluginId,
          { enabled: plugin.nativeRegistration.enabled },
        ])
      ),
      mcpServers: desired.mcps.map((mcp) => mcp.serverName).sort(),
      userSkills: desired.skills
        .filter((skill) => skill.syncMode === (nativeUserSkillsDir ? "user-skill-dir" : "cache-only"))
        .map((skill) => skill.artifactName)
        .sort(),
    },
    findings: [],
  });
  snapshot.findings = buildFindings(snapshot);

  if (options.write) {
    const outputPath = path.join(
      options.root,
      "generated",
      "machines",
      machine.machineId,
      runtime.runtimeId,
      "runtime-audit.json"
    );
    await ensureDir(path.dirname(outputPath));
    await writeJsonFile(outputPath, snapshot);
  }

  return snapshot;
}

export function formatRuntimeAudit(snapshot: RuntimeAuditSnapshot) {
  if (snapshot.findings.length === 0) {
    return `Runtime audit passed for ${snapshot.runtimeId} on ${snapshot.machineId}.`;
  }

  return [
    `Runtime audit found ${snapshot.findings.length} finding(s) for ${snapshot.runtimeId} on ${snapshot.machineId}:`,
    ...snapshot.findings.map((finding) => `- ${finding}`),
  ].join("\n");
}

async function readDesiredState(root: string, machineId: string, runtimeId: string): Promise<RenderedRuntimeState> {
  const desiredPath = path.join(root, "generated", "machines", machineId, runtimeId, "desired-state.json");
  if (await pathExists(desiredPath)) {
    return renderedRuntimeStateSchema.parse(await readJsonFile(desiredPath));
  }

  return renderedRuntimeStateSchema.parse({
    machineId,
    runtimeId,
    generatedAt: null,
    profileMode: "managed",
    nativeFiles: {},
    cacheBindings: {},
    ownedStateFile: "unrendered",
    skills: [],
    plugins: [],
    mcps: [],
  });
}

async function readCodexPlugins(configPath: string) {
  const config = await readCodexToml(configPath);
  const plugins = asRecord(config.plugins);
  return Object.fromEntries(
    Object.entries(plugins)
      .map(([pluginId, value]) => [pluginId, { enabled: pluginEnabled(value) }] as const)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

async function readCodexMcpServerNames(configPath: string) {
  const config = await readCodexToml(configPath);
  return Object.keys(asRecord(config.mcp_servers)).sort();
}

async function readCodexToml(configPath: string) {
  if (!(await pathExists(configPath))) {
    return {};
  }
  const text = await readText(configPath);
  return text.trim() ? (TOML.parse(text) as Record<string, unknown>) : {};
}

async function readSkillDirNames(skillsDir: string) {
  const entries = await listTopLevelEntries(skillsDir);
  return entries.filter((entry) => entry.kind === "directory").map((entry) => entry.name).sort();
}

async function readPluginSkillRoots(pluginCacheDir: string) {
  if (!(await pathExists(pluginCacheDir))) {
    return [];
  }

  const roots: RuntimeAuditSnapshot["actual"]["pluginSkills"] = [];
  const marketplaces = await listTopLevelEntries(pluginCacheDir);
  for (const marketplace of marketplaces.filter((entry) => entry.kind === "directory")) {
    const plugins = await listTopLevelEntries(marketplace.path);
    for (const plugin of plugins.filter((entry) => entry.kind === "directory")) {
      const versions = await listTopLevelEntries(plugin.path);
      for (const version of versions.filter((entry) => entry.kind === "directory")) {
        const skillsRoot = path.join(version.path, "skills");
        if (!(await pathExists(skillsRoot))) {
          continue;
        }
        roots.push({
          pluginId: `${plugin.name}@${marketplace.name}`,
          root: skillsRoot,
          skills: await readSkillDirNames(skillsRoot),
        });
      }
    }
  }

  return roots.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

function buildFindings(snapshot: RuntimeAuditSnapshot) {
  const findings: string[] = [];
  const actualPluginIds = new Set(Object.keys(snapshot.actual.plugins));
  const desiredPluginIds = new Set(Object.keys(snapshot.desired.plugins));

  for (const pluginId of [...desiredPluginIds].sort()) {
    const desired = snapshot.desired.plugins[pluginId]!;
    const actual = snapshot.actual.plugins[pluginId];
    if (!actual) {
      findings.push(`Codex plugin ${pluginId} is desired but missing from actual config.`);
      continue;
    }
    if (actual.enabled !== desired.enabled) {
      findings.push(`Codex plugin ${pluginId} enabled=${actual.enabled} but desired=${desired.enabled}.`);
    }
  }

  for (const pluginId of [...actualPluginIds].sort()) {
    if (!desiredPluginIds.has(pluginId) && !ALLOWED_UNMANAGED_PLUGIN_IDS.has(pluginId)) {
      findings.push(`Codex plugin ${pluginId} is unmanaged by agent-governance.`);
    }
    if (HIGH_RISK_PLUGIN_IDS.has(pluginId) && snapshot.actual.plugins[pluginId]?.enabled !== false) {
      findings.push(`High-risk Codex plugin ${pluginId} is enabled or not explicitly disabled.`);
    }
  }

  addMissingAndUnmanaged(
    findings,
    "Codex MCP server",
    snapshot.actual.mcpServers,
    snapshot.desired.mcpServers,
    ALLOWED_UNMANAGED_MCP_SERVER_NAMES
  );
  addMissingAndUnmanaged(
    findings,
    "Codex user skill",
    snapshot.actual.userSkills,
    snapshot.desired.userSkills,
    ALLOWED_UNMANAGED_USER_SKILLS
  );

  for (const pluginSkillRoot of snapshot.actual.pluginSkills) {
    if (
      HIGH_RISK_PLUGIN_IDS.has(pluginSkillRoot.pluginId) &&
      snapshot.actual.plugins[pluginSkillRoot.pluginId]?.enabled !== false
    ) {
      findings.push(
        `High-risk plugin skill root is active for ${pluginSkillRoot.pluginId}: ${pluginSkillRoot.skills.join(", ")}.`
      );
    }
  }

  return findings;
}

function addMissingAndUnmanaged(
  findings: string[],
  label: string,
  actual: string[],
  desired: string[],
  allowedUnmanaged: Set<string> = new Set()
) {
  const actualSet = new Set(actual);
  const desiredSet = new Set(desired);
  for (const item of desired) {
    if (!actualSet.has(item)) {
      findings.push(`${label} ${item} is desired but missing from actual runtime.`);
    }
  }
  for (const item of actual) {
    if (!desiredSet.has(item) && !allowedUnmanaged.has(item)) {
      findings.push(`${label} ${item} is unmanaged by agent-governance.`);
    }
  }
}

function pluginEnabled(value: unknown) {
  if (value && typeof value === "object" && "enabled" in value) {
    return (value as { enabled?: unknown }).enabled !== false;
  }
  return value !== false;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function runtimeNativePath(
  runtime: RuntimeRecord,
  machine: MachineRecord,
  vars: Record<string, string>,
  name: string,
  required = true
) {
  const binding = runtime.nativeFiles.find((item) => item.name === name);
  const template = machine.runtimeTargets[runtime.runtimeId]?.nativeFiles?.[name] ?? binding?.template;
  if (!template) {
    if (required) {
      throw new Error(`Missing required native file binding ${name} for ${runtime.runtimeId}.`);
    }
    return null;
  }
  return renderTemplate(template, vars);
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Unknown template variable ${key} in ${template}.`);
    }
    return vars[key]!;
  });
}
