import { parseArgs } from "node:util";
import {
  approveCapability,
  auditGovernance,
  changeCapabilityLifecycle,
  type IngestInput,
  ingestCapability,
  publishGovernance,
  renderGovernance,
  resolveContext,
  reviewCapability,
  syncGovernance,
} from "../src/governance.js";
import { importLocalMachineState } from "../src/local-import.js";

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  const { values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      bootstrap: { type: "string" },
      machine: { type: "string" },
      runtime: { type: "string" },
      id: { type: "string" },
      name: { type: "string" },
      "asset-kind": { type: "string" },
      "runtime-target": { type: "string", multiple: true },
      "discovery-source": { type: "string", multiple: true },
      "discovery-url": { type: "string" },
      "canonical-source": { type: "string" },
      "canonical-url": { type: "string" },
      "canonical-ref": { type: "string" },
      "canonical-ref-type": { type: "string" },
      "canonical-path": { type: "string" },
      "artifact-name": { type: "string" },
      "source-path": { type: "string" },
      "risk-tier": { type: "string" },
      tag: { type: "string", multiple: true },
      reviewer: { type: "string" },
      "reviewed-at": { type: "string" },
      license: { type: "string" },
      status: { type: "string" },
      "executes-scripts": { type: "boolean" },
      "network-access": { type: "boolean" },
      "touches-credentials": { type: "boolean" },
      "filesystem-side-effects": { type: "string" },
      note: { type: "string", multiple: true },
      "hydrate-hash": { type: "boolean" },
      reason: { type: "string" },
      "lock-file": { type: "string" },
      "stale-days": { type: "string" },
      "check-upstream": { type: "boolean" },
    },
  });

  const context = await resolveContext({
    ...(values.root ? { root: values.root } : {}),
    ...(values.bootstrap ? { bootstrapPath: values.bootstrap } : {}),
  });

  switch (command) {
    case "ingest": {
      const input: IngestInput = {
        id: required(values.id, "--id"),
        name: required(values.name, "--name"),
        assetKind: required(values["asset-kind"], "--asset-kind") as IngestInput["assetKind"],
        runtimeTargets: values["runtime-target"] ?? [],
        discoverySources: values["discovery-source"] ?? [],
        canonicalSourceId: required(values["canonical-source"], "--canonical-source"),
        canonicalUrl: required(values["canonical-url"], "--canonical-url"),
        canonicalRef: required(values["canonical-ref"], "--canonical-ref"),
        canonicalRefType: (values["canonical-ref-type"] ?? "commit") as IngestInput["canonicalRefType"],
        canonicalPath: required(values["canonical-path"], "--canonical-path"),
        riskTier: required(values["risk-tier"], "--risk-tier") as IngestInput["riskTier"],
        tags: values.tag ?? [],
      };
      if (values["discovery-url"]) {
        input.discoveryUrl = values["discovery-url"];
      }
      if (values["artifact-name"]) {
        input.artifactName = values["artifact-name"];
      }
      if (values["source-path"]) {
        input.sourcePath = values["source-path"];
      }
      const filePath = await ingestCapability(context.root, input);
      console.log(`Ingested candidate capability at ${filePath}`);
      return;
    }

    case "review": {
      const reviewInput = {
        notes: values.note ?? [],
      } as Parameters<typeof reviewCapability>[2];
      if (values.reviewer) {
        reviewInput.reviewer = values.reviewer;
      }
      if (values["reviewed-at"]) {
        reviewInput.reviewedAt = values["reviewed-at"];
      }
      if (values.license) {
        reviewInput.license = values.license;
      }
      if (values.status) {
        reviewInput.status = values.status as "pending" | "approved" | "rejected";
      }
      if (values["executes-scripts"] !== undefined) {
        reviewInput.executesScripts = values["executes-scripts"];
      }
      if (values["network-access"] !== undefined) {
        reviewInput.networkAccess = values["network-access"];
      }
      if (values["touches-credentials"] !== undefined) {
        reviewInput.touchesCredentials = values["touches-credentials"];
      }
      if (values["filesystem-side-effects"]) {
        reviewInput.filesystemSideEffects = values["filesystem-side-effects"];
      }
      if (values["hydrate-hash"] !== undefined) {
        reviewInput.hydrateHash = values["hydrate-hash"];
      }
      const report = await reviewCapability(context.root, required(values.id, "--id"), reviewInput);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    case "approve":
      await approveCapability(context.root, required(values.id, "--id"));
      console.log(`Approved ${values.id}`);
      return;

    case "publish": {
      const lock = await publishGovernance(context.root);
      console.log(`Published ${lock.capabilities.length} capabilities.`);
      return;
    }

    case "render": {
      const bootstrap = requireBootstrap(context.bootstrap, values.bootstrap);
      const machineId = values.machine ?? bootstrap.machineId;
      const result = await renderGovernance({
        root: context.root,
        machineId,
        bootstrap,
        ...(values["lock-file"] ? { lockFile: values["lock-file"] } : {}),
      });
      console.log(
        `Rendered shared cache and ${result.renderedStates.length} runtime state files for ${machineId}.`
      );
      return;
    }

    case "sync": {
      const bootstrap = requireBootstrap(context.bootstrap, values.bootstrap);
      const machineId = values.machine ?? bootstrap.machineId;
      if (values["lock-file"]) {
        await renderGovernance({
          root: context.root,
          machineId,
          bootstrap,
          ...(values["lock-file"] ? { lockFile: values["lock-file"] } : {}),
        });
      }
      await syncGovernance({
        root: context.root,
        machineId,
        runtimeId: required(values.runtime, "--runtime"),
        bootstrap,
      });
      console.log(`Synced ${values.runtime} for ${machineId}.`);
      return;
    }

    case "audit": {
      const findings = await auditGovernance(context.root, {
        staleDays: Number(values["stale-days"] ?? "90"),
        checkUpstream: values["check-upstream"] ?? false,
      });
      if (findings.length === 0) {
        console.log("Audit passed with no findings.");
        return;
      }
      console.log(findings.map((finding) => `- ${finding}`).join("\n"));
      process.exitCode = 1;
      return;
    }

    case "import-local": {
      const bootstrap = requireBootstrap(context.bootstrap, values.bootstrap);
      const machineId = values.machine ?? bootstrap.machineId;
      const summary = await importLocalMachineState({
        root: context.root,
        bootstrap,
        machineId,
        ...(values.reviewer ? { reviewer: values.reviewer } : {}),
      });
      const skippedSuffix =
        summary.skippedSkills.length > 0
          ? ` Skipped ${summary.skippedSkills.length} invalid skills.`
          : "";
      console.log(
        `Seeded ${summary.skillCount} skills, ${summary.pluginCount} plugins, ${summary.pluginBindingCount} plugin bindings, and ${summary.mcpCount} MCPs from local machine state.${skippedSuffix}`
      );
      return;
    }

    case "deprecate":
      await changeCapabilityLifecycle(
        context.root,
        required(values.id, "--id"),
        "deprecated",
        values.reason
      );
      console.log(`Deprecated ${values.id}`);
      return;

    case "block":
      await changeCapabilityLifecycle(
        context.root,
        required(values.id, "--id"),
        "blocked",
        values.reason
      );
      console.log(`Blocked ${values.id}`);
      return;

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function required(value: string | undefined, flag: string) {
  if (!value) {
    throw new Error(`Missing required option ${flag}.`);
  }
  return value;
}

function requireBootstrap(
  bootstrap: Awaited<ReturnType<typeof resolveContext>>["bootstrap"],
  bootstrapFlag: string | undefined
) {
  if (!bootstrap) {
    const source = bootstrapFlag
      ? `bootstrap file ${bootstrapFlag}`
      : "the default bootstrap configuration";
    throw new Error(`Missing ${source}. Create ~/.config/agent-governance/bootstrap.yaml first.`);
  }
  return bootstrap;
}

function printHelp() {
  console.log(`Usage: pnpm governance <command> [options]

Commands:
  ingest      Create a candidate capability YAML from a discovery source
  review      Update review metadata and optionally hydrate a digest
  approve     Move a reviewed capability to approved
  publish     Generate the global resolution lock
  render      Render shared cache and machine/runtime desired state
  sync        Sync a managed runtime from rendered desired state
  audit       Check for lock drift, stale reviews, and optional upstream drift
  import-local Capture current local global state into the repo and adopt it as managed
  deprecate   Mark a capability deprecated
  block       Mark a capability blocked

Global options:
  --root <path>         Governance repo root
  --bootstrap <path>    Bootstrap file path
  --machine <id>        Machine id for render/sync
  --runtime <id>        Runtime id for sync
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
