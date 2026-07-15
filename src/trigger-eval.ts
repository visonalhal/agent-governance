import path from "node:path";
import { loadRepo } from "./governance.js";
import { pathExists, readYamlFile } from "./io.js";

type TriggerEvalFile = {
  scenarios?: TriggerEvalScenario[];
};

type TriggerEvalScenario = {
  id: string;
  prompt: string;
  expectedSkills?: string[];
  forbiddenSkills?: string[];
};

export type TriggerEvalReport = {
  passed: boolean;
  failures: string[];
  scenarios: Array<{
    id: string;
    predictedSkills: string[];
  }>;
};

export async function runTriggerEvals(root: string): Promise<TriggerEvalReport> {
  const evalPath = path.join(root, "evals", "trigger-evals.yaml");
  if (!(await pathExists(evalPath))) {
    return {
      passed: false,
      failures: [`Missing trigger eval file at ${evalPath}.`],
      scenarios: [],
    };
  }

  const repo = await loadRepo(root);
  const capabilityIds = new Set(repo.capabilities.map((capability) => capability.id));
  const evalFile = (await readYamlFile<TriggerEvalFile>(evalPath)).scenarios ?? [];
  const failures: string[] = [];
  const scenarios: TriggerEvalReport["scenarios"] = [];

  for (const scenario of evalFile) {
    const predictedSkills = predictSkills(scenario.prompt);
    scenarios.push({
      id: scenario.id,
      predictedSkills: [...predictedSkills].sort(),
    });

    for (const skillId of [...(scenario.expectedSkills ?? []), ...(scenario.forbiddenSkills ?? [])]) {
      if (!capabilityIds.has(skillId)) {
        failures.push(`${scenario.id}: references unknown capability ${skillId}.`);
      }
    }

    for (const skillId of scenario.expectedSkills ?? []) {
      if (!predictedSkills.has(skillId)) {
        failures.push(`${scenario.id}: expected ${skillId} but predictor did not select it.`);
      }
    }

    for (const skillId of scenario.forbiddenSkills ?? []) {
      if (predictedSkills.has(skillId)) {
        failures.push(`${scenario.id}: forbids ${skillId} but predictor selected it.`);
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    scenarios,
  };
}

function predictSkills(prompt: string) {
  const lower = prompt.toLowerCase();
  const selected = new Set<string>();

  if (
    matches(lower, [
      "agent governance",
      "agent-governance",
      "agent-governnance",
      "skill governance",
      "skills registry",
      "globalize",
      "global skill",
      "project opt-in",
      "trigger drift",
    ])
  ) {
    selected.add("skill.agent-governance");
  }

  if (
    matches(lower, [
      "prompt template",
      "system prompt",
      "skill prompt",
      "prompt pack",
      "trigger and anti-trigger",
      "anti-trigger examples",
      "compress this prompt",
      "audit this prompt",
      "rewrite this prompt",
      "design a prompt",
    ])
  ) {
    selected.add("skill.prompt-master");
  }

  if (matches(lower, ["playwright", "e2e", "browser test"])) {
    selected.add("skill.playwright-best-practices");
  }

  return selected;
}

function matches(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}
