import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { loadRepo } from "./governance.js";
import type { BootstrapRecord, MachineRecord, RenderedRuntimeState, RuntimeAuditSnapshot, RuntimeRecord } from "./schema.js";
import {
  renderedProjectRuntimeStatesSchema,
  renderedRuntimeStateSchema,
  runtimeAuditSnapshotSchema,
} from "./schema.js";
import {
  computeDirectoryDigest,
  ensureDir,
  listTopLevelEntries,
  pathExists,
  readJsonFile,
  readText,
  writeJsonFile,
} from "./io.js";

const CODEX_GLOBAL_AGENTS_SOURCE = path.join("policies", "codex", "global-AGENTS.md");

const HIGH_RISK_PLUGIN_IDS = new Set([
  "build-web-apps@openai-curated",
  "build-web-apps@openai-curated-remote",
  "figma@openai-curated-remote",
  "superpowers@openai-curated",
  "superpowers@openai-curated-remote",
]);
const ALLOWED_UNMANAGED_PLUGIN_IDS = new Set([
  "browser@openai-bundled",
  "chrome@openai-bundled",
  "computer-use@openai-bundled",
  "documents@openai-primary-runtime",
  "pdf@openai-primary-runtime",
  "presentations@openai-primary-runtime",
  "sites@openai-bundled",
  "spreadsheets@openai-primary-runtime",
  "template-creator@openai-primary-runtime",
  "visualize@openai-bundled",
]);
const ALLOWED_UNMANAGED_MCP_SERVER_NAMES = new Set(["computer-use", "node_repl"]);

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
  const globalAgentsPath = runtimeNativePath(runtime, machine, vars, "globalAgents")!;
  const globalAgentsSourcePath = path.join(options.root, CODEX_GLOBAL_AGENTS_SOURCE);
  const globalAgentsDigest = await computeDirectoryDigest(globalAgentsSourcePath);
  const desired = await readDesiredState(options.root, machine.machineId, runtime.runtimeId);
  const desiredProjects = await readDesiredProjectStates(
    options.root,
    machine.machineId,
    runtime.runtimeId
  );
  const nativeUserSkillsDir = runtimeNativePath(runtime, machine, vars, "userSkillsDir", false);
  const userSkillsDir: string =
    nativeUserSkillsDir ?? desired.cacheBindings.skillsDir ?? path.join(vars.HOME, ".agents", "skills");
  const pluginCacheDir = path.join(vars.HOME, ".codex", "plugins", "cache");

  const actualPlugins = await readCodexPlugins(configPath);
  const machineAllowlist = machine.runtimeAuditAllowlist[runtime.runtimeId];
  const remotePluginAudit = machineAllowlist?.auditRemotePlugins
    ? await readCodexRemotePlugins()
    : { plugins: {}, error: undefined };
  const globalConfig = await readCodexToml(configPath);
  const projects = await Promise.all(
    desiredProjects.map(async ({ projectScope, state }) => {
      const configPath = state.nativeFiles.config!;
      return {
        projectScope,
        actual: {
          configPath,
          trusted: codexProjectTrusted(globalConfig, projectScope),
          plugins: await readCodexPlugins(configPath),
          mcpServers: await readCodexMcpServerNames(configPath),
          skills: await readCodexSkills(configPath),
        },
        desired: {
          trusted: true,
          plugins: desiredRuntimeSummary(state).plugins,
          mcpServers: desiredRuntimeSummary(state).mcpServers,
          skills: Object.fromEntries(
            state.skills
              .filter((skill) => skill.syncMode === "config-path")
              .map((skill) => [
                path.join(state.cacheBindings.skillsDir!, skill.artifactName),
                { enabled: true },
              ])
          ),
        },
      };
    })
  );

  const snapshot = runtimeAuditSnapshotSchema.parse({
    machineId: machine.machineId,
    runtimeId: runtime.runtimeId,
    generatedAt: new Date().toISOString(),
    actual: {
      configPath,
      globalAgentsPath,
      globalAgentsDigest: (await pathExists(globalAgentsPath))
        ? await computeDirectoryDigest(globalAgentsPath)
        : undefined,
      userSkillsDir,
      pluginCacheDir,
      plugins: actualPlugins,
      remotePlugins: remotePluginAudit.plugins,
      remotePluginAuditError: remotePluginAudit.error,
      mcpServers: await readCodexMcpServerNames(configPath),
      userSkills: await readSkillDirNames(userSkillsDir),
      pluginSkills: await readPluginSkillRoots(pluginCacheDir),
    },
    desired: {
      ...desiredRuntimeSummary(desired, nativeUserSkillsDir ? "user-skill-dir" : "cache-only"),
      globalAgentsSourcePath,
      globalAgentsDigest,
      remotePlugins: [...(machineAllowlist?.remotePlugins ?? [])].sort(),
    },
    projects,
    findings: [],
  });
  snapshot.findings = buildFindings(snapshot, machineAllowlist);
  snapshot.findings.push(...(await buildProjectFindings(snapshot)));

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

async function readDesiredProjectStates(root: string, machineId: string, runtimeId: string) {
  const desiredPath = path.join(
    root,
    "generated",
    "machines",
    machineId,
    runtimeId,
    "project-scopes.json"
  );
  if (!(await pathExists(desiredPath))) {
    return [];
  }
  return renderedProjectRuntimeStatesSchema.parse(await readJsonFile(desiredPath));
}

function desiredRuntimeSummary(
  desired: RenderedRuntimeState,
  skillSyncMode: "cache-only" | "user-skill-dir" = "user-skill-dir"
) {
  return {
    plugins: Object.fromEntries(
      desired.plugins.map((plugin) => [
        plugin.nativeRegistration.pluginId,
        { enabled: plugin.nativeRegistration.enabled },
      ])
    ),
    mcpServers: desired.mcps.map((mcp) => mcp.serverName).sort(),
    userSkills: desired.skills
      .filter((skill) => skill.syncMode === skillSyncMode)
      .map((skill) => skill.artifactName)
      .sort(),
  };
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

async function readCodexSkills(configPath: string) {
  const config = await readCodexToml(configPath);
  const skills = asRecord(config.skills);
  if (!Array.isArray(skills.config)) {
    return {};
  }
  return Object.fromEntries(
    skills.config
      .map((entry) => asRecord(entry))
      .filter((entry) => typeof entry.path === "string")
      .map((entry): [string, { enabled: boolean }] => [
        entry.path as string,
        { enabled: entry.enabled !== false },
      ])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

type RemotePluginState = RuntimeAuditSnapshot["actual"]["remotePlugins"];

export function parseInstalledRemotePlugins(result: unknown): RemotePluginState {
  const marketplaces = asRecord(result).marketplaces;
  if (!Array.isArray(marketplaces)) {
    return {};
  }

  const plugins = marketplaces.flatMap((marketplace) => {
    const entries = asRecord(marketplace).plugins;
    return Array.isArray(entries) ? entries : [];
  });

  return Object.fromEntries(
    plugins
      .map((plugin) => asRecord(plugin))
      .filter(
        (plugin) =>
          asRecord(plugin.source).type === "remote" &&
          plugin.installed === true &&
          typeof plugin.id === "string"
      )
      .map((plugin): [string, RemotePluginState[string]] => [
        plugin.id as string,
        {
          installed: true,
          enabled: plugin.enabled !== false,
          ...(typeof asRecord(plugin.interface).displayName === "string"
            ? { displayName: asRecord(plugin.interface).displayName as string }
            : {}),
          ...(typeof plugin.version === "string" ? { version: plugin.version } : {}),
        },
      ])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

async function readCodexRemotePlugins(): Promise<{ plugins: RemotePluginState; error?: string }> {
  return await new Promise((resolve) => {
    const child = spawn("codex", ["app-server"], {
      cwd: os.homedir(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: { plugins: RemotePluginState; error?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const send = (message: unknown) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const timer = setTimeout(() => {
      finish({ plugins: {}, error: "Timed out while reading Codex remote plugins." });
    }, 45_000);

    child.on("error", (error) => {
      finish({ plugins: {}, error: `Failed to start Codex app server: ${error.message}` });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      let newlineIndex = stdout.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdout.slice(0, newlineIndex);
        stdout = stdout.slice(newlineIndex + 1);
        newlineIndex = stdout.indexOf("\n");
        if (!line.trim()) {
          continue;
        }
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          send({ jsonrpc: "2.0", id: 2, method: "plugin/list", params: { forceRefetch: false } });
        }
        if (message.id === 2) {
          if (message.error) {
            finish({ plugins: {}, error: `Codex remote plugin audit failed: ${JSON.stringify(message.error)}` });
          } else {
            finish({ plugins: parseInstalledRemotePlugins(message.result) });
          }
        }
      }
    });
    child.on("exit", (code) => {
      if (!settled) {
        const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
        finish({ plugins: {}, error: `Codex app server exited with code ${code}${detail}` });
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "agent-governance-runtime-audit", version: "1" }, capabilities: {} },
    });
  });
}

function codexProjectTrusted(globalConfig: Record<string, unknown>, projectScope: string) {
  const project = asRecord(asRecord(globalConfig.projects)[projectScope]);
  return project.trust_level === "trusted";
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

function buildFindings(
  snapshot: RuntimeAuditSnapshot,
  machineAllowlist?: {
    plugins: string[];
    mcpServers: string[];
    userSkills: string[];
    remotePlugins: string[];
    auditRemotePlugins: boolean;
  }
) {
  const findings: string[] = [];
  const actualPluginIds = new Set(Object.keys(snapshot.actual.plugins));
  const desiredPluginIds = new Set(Object.keys(snapshot.desired.plugins));
  const allowedPlugins = new Set([
    ...ALLOWED_UNMANAGED_PLUGIN_IDS,
    ...(machineAllowlist?.plugins ?? []),
  ]);
  const allowedMcpServers = new Set([
    ...ALLOWED_UNMANAGED_MCP_SERVER_NAMES,
    ...(machineAllowlist?.mcpServers ?? []),
  ]);
  const allowedUserSkills = new Set(machineAllowlist?.userSkills ?? []);

  if (!snapshot.actual.globalAgentsDigest) {
    findings.push(
      `Codex global AGENTS ${snapshot.actual.globalAgentsPath} is desired but missing from the runtime.`
    );
  } else if (snapshot.actual.globalAgentsDigest !== snapshot.desired.globalAgentsDigest) {
    findings.push(
      `Codex global AGENTS ${snapshot.actual.globalAgentsPath} differs from ${snapshot.desired.globalAgentsSourcePath}.`
    );
  }

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
    if (!desiredPluginIds.has(pluginId) && !allowedPlugins.has(pluginId)) {
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
    allowedMcpServers
  );
  addMissingAndUnmanaged(
    findings,
    "Codex user skill",
    snapshot.actual.userSkills,
    snapshot.desired.userSkills,
    allowedUserSkills
  );

  for (const pluginSkillRoot of snapshot.actual.pluginSkills) {
    if (
      HIGH_RISK_PLUGIN_IDS.has(pluginSkillRoot.pluginId) &&
      pluginIsActive(snapshot, pluginSkillRoot.pluginId)
    ) {
      findings.push(
        `High-risk plugin skill root is active for ${pluginSkillRoot.pluginId}: ${pluginSkillRoot.skills.join(", ")}.`
      );
    }
  }

  if (machineAllowlist?.auditRemotePlugins) {
    if (snapshot.actual.remotePluginAuditError) {
      findings.push(snapshot.actual.remotePluginAuditError);
    } else {
      const desiredRemotePlugins = new Set(snapshot.desired.remotePlugins);
      const actualRemotePluginIds = Object.keys(snapshot.actual.remotePlugins).sort();
      for (const pluginId of snapshot.desired.remotePlugins) {
        const actual = snapshot.actual.remotePlugins[pluginId];
        if (!actual?.installed) {
          findings.push(`Codex remote plugin ${pluginId} is allowlisted but not installed.`);
        } else if (!actual.enabled) {
          findings.push(`Codex remote plugin ${pluginId} is installed but disabled.`);
        }
      }
      for (const pluginId of actualRemotePluginIds) {
        if (!desiredRemotePlugins.has(pluginId)) {
          findings.push(`Codex remote plugin ${pluginId} is installed but not allowlisted.`);
        }
        if (HIGH_RISK_PLUGIN_IDS.has(pluginId) && snapshot.actual.remotePlugins[pluginId]?.enabled) {
          findings.push(`High-risk Codex remote plugin ${pluginId} is installed and enabled.`);
        }
      }
    }
  }

  return findings;
}

function pluginIsActive(snapshot: RuntimeAuditSnapshot, pluginId: string) {
  const remote = snapshot.actual.remotePlugins[pluginId];
  if (remote) {
    return remote.installed && remote.enabled;
  }
  if (pluginId.endsWith("@openai-curated-remote")) {
    return false;
  }
  return snapshot.actual.plugins[pluginId]?.enabled !== false;
}

async function buildProjectFindings(snapshot: RuntimeAuditSnapshot) {
  const findings: string[] = [];
  for (const project of snapshot.projects) {
    if (project.actual.trusted !== project.desired.trusted) {
      findings.push(
        `[${project.projectScope}] Codex project trusted=${project.actual.trusted} but desired=${project.desired.trusted}.`
      );
    }
    addRecordDriftFindings(
      findings,
      project.projectScope,
      "Codex plugin",
      project.actual.plugins,
      project.desired.plugins
    );
    addMissingAndUnmanaged(
      findings,
      `[${project.projectScope}] Codex MCP server`,
      project.actual.mcpServers,
      project.desired.mcpServers
    );
    addRecordDriftFindings(
      findings,
      project.projectScope,
      "Codex skill path",
      project.actual.skills,
      project.desired.skills
    );
    for (const skillPath of Object.keys(project.desired.skills)) {
      if (!(await pathExists(skillPath))) {
        findings.push(`[${project.projectScope}] Codex skill path ${skillPath} does not exist.`);
      }
    }
  }
  return findings;
}

function addRecordDriftFindings(
  findings: string[],
  projectScope: string,
  label: string,
  actual: Record<string, { enabled: boolean }>,
  desired: Record<string, { enabled: boolean }>
) {
  for (const [id, desiredState] of Object.entries(desired)) {
    const actualState = actual[id];
    if (!actualState) {
      findings.push(`[${projectScope}] ${label} ${id} is desired but missing.`);
    } else if (actualState.enabled !== desiredState.enabled) {
      findings.push(
        `[${projectScope}] ${label} ${id} enabled=${actualState.enabled} but desired=${desiredState.enabled}.`
      );
    }
  }
  for (const id of Object.keys(actual)) {
    if (!(id in desired)) {
      findings.push(`[${projectScope}] ${label} ${id} is unmanaged by agent-governance.`);
    }
  }
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
