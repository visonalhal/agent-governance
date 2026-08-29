import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  computeDirectoryDigest,
  copyDirectory,
  ensureDir,
  listFiles,
  pathExists,
  readText,
  readYamlFile,
  removePath,
  writeJsonFile,
} from "./io.js";

const behaviorEvalScenarioSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  sandbox: z.enum(["read-only", "workspace-write"]).default("read-only"),
  fixture: z.string().min(1).optional(),
  explicitSkills: z.array(z.string().min(1)).default([]),
  expectedSkills: z.array(z.string().min(1)).default([]),
  forbiddenSkills: z.array(z.string().min(1)).default([]),
  requiredResponseContains: z.array(z.string().min(1)).default([]),
  requiredChangedFiles: z.array(z.string().min(1)).default([]),
  allowedChangedFiles: z.array(z.string().min(1)).optional(),
  requiredCommandContains: z.array(z.string().min(1)).default([]),
  requiredFileContains: z.record(z.string(), z.array(z.string().min(1))).default({}),
  forbiddenFileContains: z.record(z.string(), z.array(z.string().min(1))).default({}),
  maxToolCalls: z.number().int().min(0).optional(),
}).superRefine((scenario, context) => {
  if (scenario.sandbox === "workspace-write" && !scenario.fixture) {
    context.addIssue({
      code: "custom",
      path: ["fixture"],
      message: "workspace-write behavior evals require an isolated fixture",
    });
  }
  if (scenario.fixture && scenario.sandbox !== "workspace-write") {
    context.addIssue({
      code: "custom",
      path: ["sandbox"],
      message: "fixture behavior evals must use workspace-write",
    });
  }
});

const behaviorEvalFileSchema = z.object({
  version: z.literal(1),
  scenarios: z.array(behaviorEvalScenarioSchema).min(1),
});

type BehaviorEvalScenario = z.infer<typeof behaviorEvalScenarioSchema>;

export type BehaviorEvalReport = {
  passed: boolean;
  dryRun: boolean;
  generatedAt: string;
  failures: string[];
  scenarios: Array<{
    id: string;
    cwd: string;
    status: "planned" | "passed" | "failed";
    explicitSkills: string[];
    skillReads: string[];
    toolCallCount: number;
    commands: string[];
    changedFiles: string[];
    finalResponse: string;
    durationMs: number;
    error?: string;
  }>;
};

export async function runBehaviorEvals(options: {
  root: string;
  dryRun?: boolean;
  scenarioIds?: string[];
  write?: boolean;
}) {
  const config = behaviorEvalFileSchema.parse(
    await readYamlFile(path.join(options.root, "evals", "behavior-evals.yaml"))
  );
  const requestedIds = new Set(options.scenarioIds ?? []);
  const scenarios = config.scenarios.filter(
    (scenario) => requestedIds.size === 0 || requestedIds.has(scenario.id)
  );
  const missingIds = [...requestedIds].filter(
    (id) => !config.scenarios.some((scenario) => scenario.id === id)
  );
  if (missingIds.length > 0) {
    throw new Error(`Unknown behavior eval scenario(s): ${missingIds.join(", ")}.`);
  }

  const report: BehaviorEvalReport = {
    passed: true,
    dryRun: options.dryRun ?? false,
    generatedAt: new Date().toISOString(),
    failures: [],
    scenarios: [],
  };

  for (const scenario of scenarios) {
    const cwd = path.resolve(options.root, scenario.cwd);
    const reportCwd = path.resolve(options.root, scenario.fixture ?? scenario.cwd);
    if (options.dryRun) {
      report.scenarios.push({
        id: scenario.id,
        cwd: reportCwd,
        status: "planned",
        explicitSkills: scenario.explicitSkills,
        skillReads: [],
        toolCallCount: 0,
        commands: [],
        changedFiles: [],
        finalResponse: "",
        durationMs: 0,
      });
      continue;
    }

    const result = await runScenario(scenario, cwd, options.root);
    report.scenarios.push(result);
    if (result.status === "failed") {
      report.passed = false;
      report.failures.push(result.error ?? `${scenario.id}: behavior contract failed.`);
    }
  }

  if (options.write) {
    const outputDir = path.join(options.root, "generated", "behavior-evals");
    await ensureDir(outputDir);
    await writeJsonFile(path.join(outputDir, "latest.json"), report);
  }
  return report;
}

async function runScenario(
  scenario: BehaviorEvalScenario,
  cwd: string,
  root: string
): Promise<BehaviorEvalReport["scenarios"][number]> {
  const startedAt = Date.now();
  const reportCwd = path.resolve(root, scenario.fixture ?? scenario.cwd);
  let workingDirectory = cwd;
  let temporaryDirectory: string | null = null;
  try {
    if (scenario.fixture) {
      const fixturePath = path.resolve(root, scenario.fixture);
      if (!(await pathExists(fixturePath))) {
        throw new Error(`Behavior eval fixture does not exist: ${fixturePath}`);
      }
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-governance-behavior-"));
      await copyDirectory(fixturePath, temporaryDirectory);
      workingDirectory = temporaryDirectory;
    }
    const beforeFiles = scenario.fixture ? await snapshotFiles(workingDirectory) : {};
    const stdout = await execCodexWithClosedStdin(
      [
        "exec",
        "--ephemeral",
        "--json",
        "--sandbox",
        scenario.sandbox,
        "--skip-git-repo-check",
        "-C",
        workingDirectory,
        scenario.prompt,
      ],
      workingDirectory
    );
    const observed = analyzeBehaviorEvalEvents(stdout);
    const afterFiles = scenario.fixture ? await snapshotFiles(workingDirectory) : {};
    const changedFiles = changedFilePaths(beforeFiles, afterFiles);
    const failures = await evaluateScenarioContract(
      scenario,
      observed,
      workingDirectory,
      changedFiles
    );
    return {
      id: scenario.id,
      cwd: reportCwd,
      status: failures.length === 0 ? "passed" : "failed",
      explicitSkills: scenario.explicitSkills,
      skillReads: observed.skillReads,
      toolCallCount: observed.toolCallCount,
      commands: observed.commands,
      changedFiles,
      finalResponse: observed.finalResponse,
      durationMs: Date.now() - startedAt,
      ...(failures.length > 0 ? { error: `${scenario.id}: ${failures.join(" ")}` } : {}),
    };
  } catch (error) {
    const detail = summarizeBehaviorEvalError(error);
    return {
      id: scenario.id,
      cwd: reportCwd,
      status: "failed",
      explicitSkills: scenario.explicitSkills,
      skillReads: [],
      toolCallCount: 0,
      commands: [],
      changedFiles: [],
      finalResponse: "",
      durationMs: Date.now() - startedAt,
      error: `${scenario.id}: live Codex run failed: ${detail}`,
    };
  } finally {
    if (temporaryDirectory) {
      await removePath(temporaryDirectory);
    }
  }
}

function execCodexWithClosedStdin(args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.env.CODEX_BIN ?? "codex",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
    child.stdin?.end();
  });
}

export function summarizeBehaviorEvalError(error: unknown) {
  const record = asRecord(error);
  const rawCandidates = [record.stdout, record.stderr, error instanceof Error ? error.message : error]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const raw of rawCandidates) {
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim().startsWith("{")) {
        continue;
      }
      try {
        const event = asRecord(JSON.parse(line));
        if (event.type === "turn.failed") {
          const eventError = asRecord(event.error);
          if (typeof eventError.message === "string") {
            return compactError(eventError.message);
          }
        }
      } catch {
        // Ignore non-event output and fall back to a compact process error.
      }
    }
  }

  const combined = rawCandidates.join("\n");
  if (/refresh_token_invalidated|refresh token (?:is )?(?:invalid|revoked)/i.test(combined)) {
    return "Codex authentication failed: the OAuth refresh token is invalidated; sign in again.";
  }
  return compactError(rawCandidates.at(-1) ?? String(error));
}

function compactError(value: string) {
  const compact = value.replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;
}

async function evaluateScenarioContract(
  scenario: BehaviorEvalScenario,
  observed: ReturnType<typeof analyzeBehaviorEvalEvents>,
  cwd: string,
  changedFiles: string[]
) {
  const failures: string[] = [];
  for (const skill of scenario.explicitSkills) {
    if (!scenario.prompt.includes(`$${skill}`)) {
      failures.push(`Explicit skill ${skill} is not present in the scenario prompt.`);
    }
  }
  for (const skill of scenario.expectedSkills) {
    if (!observed.skillReads.includes(skill)) {
      failures.push(`Expected skill ${skill} was not read.`);
    }
  }
  for (const skill of scenario.forbiddenSkills) {
    if (observed.skillReads.includes(skill)) {
      failures.push(`Forbidden skill ${skill} was read.`);
    }
  }
  if (scenario.maxToolCalls !== undefined && observed.toolCallCount > scenario.maxToolCalls) {
    failures.push(
      `Observed ${observed.toolCallCount} tool calls, above maximum ${scenario.maxToolCalls}.`
    );
  }
  if (!observed.finalResponse.trim()) {
    failures.push("Codex produced no final response.");
  }
  for (const requiredText of scenario.requiredResponseContains) {
    if (!observed.finalResponse.includes(requiredText)) {
      failures.push(`Final response did not contain required text: ${requiredText}.`);
    }
  }
  for (const requiredFile of scenario.requiredChangedFiles) {
    if (!changedFiles.includes(requiredFile)) {
      failures.push(`Required file ${requiredFile} was not changed.`);
    }
  }
  if (scenario.allowedChangedFiles) {
    const allowed = new Set(scenario.allowedChangedFiles);
    for (const changedFile of changedFiles) {
      if (!allowed.has(changedFile)) {
        failures.push(`Unexpected file ${changedFile} was changed.`);
      }
    }
  }
  for (const requiredCommand of scenario.requiredCommandContains) {
    if (!observed.commands.some((command) => command.includes(requiredCommand))) {
      failures.push(`No command contained required text: ${requiredCommand}.`);
    }
  }
  for (const [relativePath, requiredTexts] of Object.entries(scenario.requiredFileContains)) {
    const text = await readFixtureFile(cwd, relativePath, failures);
    for (const requiredText of requiredTexts) {
      if (text !== null && !text.includes(requiredText)) {
        failures.push(`${relativePath} did not contain required text: ${requiredText}.`);
      }
    }
  }
  for (const [relativePath, forbiddenTexts] of Object.entries(scenario.forbiddenFileContains)) {
    const text = await readFixtureFile(cwd, relativePath, failures);
    for (const forbiddenText of forbiddenTexts) {
      if (text !== null && text.includes(forbiddenText)) {
        failures.push(`${relativePath} contained forbidden text: ${forbiddenText}.`);
      }
    }
  }
  return failures;
}

export function analyzeBehaviorEvalEvents(jsonl: string) {
  const skillReads = new Set<string>();
  const commands = new Set<string>();
  let toolCallCount = 0;
  let finalResponse = "";

  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(event);
    const item = asRecord(record.item);
    if (item.type === "command_execution" && typeof item.command === "string") {
      commands.add(item.command);
      for (const match of item.command.matchAll(/[\\/]([^\\/"'\s]+)[\\/]SKILL\.md/g)) {
        if (match[1]) {
          skillReads.add(match[1]);
        }
      }
    }
    if (
      record.type === "item.started" &&
      ["command_execution", "mcp_tool_call", "web_search"].includes(String(item.type))
    ) {
      toolCallCount += 1;
    }
    if (record.type === "item.completed" && item.type === "agent_message") {
      finalResponse = typeof item.text === "string" ? item.text : finalResponse;
    }
    if (record.type === "turn.failed") {
      const error = asRecord(record.error);
      throw new Error(typeof error.message === "string" ? error.message : "Codex turn failed.");
    }
  }

  return {
    skillReads: [...skillReads].sort(),
    toolCallCount,
    commands: [...commands],
    finalResponse,
  };
}

async function snapshotFiles(root: string) {
  const snapshot: Record<string, string> = {};
  for (const filePath of await listFiles(root, "")) {
    snapshot[path.relative(root, filePath).split(path.sep).join("/")] =
      await computeDirectoryDigest(filePath);
  }
  return snapshot;
}

function changedFilePaths(before: Record<string, string>, after: Record<string, string>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((filePath) => before[filePath] !== after[filePath])
    .sort();
}

async function readFixtureFile(cwd: string, relativePath: string, failures: string[]) {
  const filePath = path.resolve(cwd, relativePath);
  if (!filePath.startsWith(`${path.resolve(cwd)}${path.sep}`) || !(await pathExists(filePath))) {
    failures.push(`Expected fixture file ${relativePath} does not exist.`);
    return null;
  }
  return await readText(filePath);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
