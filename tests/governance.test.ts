import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TOML from "@iarna/toml";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import {
  approveCapability,
  auditGovernance,
  changeCapabilityLifecycle,
  ingestCapability,
  loadBootstrap,
  publishGovernance,
  renderGovernance,
  resolveContext,
  reviewCapability,
  syncGovernance,
} from "../src/governance.js";
import { importLocalMachineState } from "../src/local-import.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXED_REVIEW_DATE = "2026-04-02T00:00:00.000Z";

describe.sequential("agent governance", () => {
  it("resolves the repo and machine from the default bootstrap path", async () => {
    const sandbox = await createSandbox();

    try {
      const context = await resolveContext();

      expect(context.root).toBe(sandbox.root);
      expect(context.bootstrap?.machineId).toBe(sandbox.machineId);
      expect(context.bootstrap?.cacheRoot).toBe(sandbox.cacheRoot);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("ingests discovery entries as candidate capabilities", async () => {
    const sandbox = await createSandbox();

    try {
      const filePath = await ingestCapability(sandbox.root, {
        id: "skill.vendor.discovery-skill",
        name: "Discovery Skill",
        assetKind: "skill",
        runtimeTargets: ["codex"],
        discoverySources: ["awesome-skills"],
        discoveryUrl: "https://awesome-skills.com/example",
        canonicalSourceId: "github-direct",
        canonicalUrl: "https://github.com/example/discovery-skill",
        canonicalRef: "main",
        canonicalRefType: "branch",
        canonicalPath: "skills/discovery-skill",
        sourcePath: "tests/fixtures/assets/sample-skill",
        riskTier: "T1",
        tags: ["catalog"],
      });

      const capability = YAML.parse(await fs.readFile(filePath, "utf8")) as {
        lifecycleState: string;
        discoverySources: string[];
      };

      expect(capability.lifecycleState).toBe("candidate");
      expect(capability.discoverySources).toEqual(["awesome-skills"]);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("fails approval and publish when a T2 capability has no completed review or digest", async () => {
    const sandbox = await createSandbox();

    try {
      await ingestCapability(sandbox.root, {
        id: "skill.vendor.needs-review",
        name: "Needs Review",
        assetKind: "skill",
        runtimeTargets: ["codex"],
        discoverySources: ["awesome-skills"],
        canonicalSourceId: "github-direct",
        canonicalUrl: "https://github.com/example/needs-review",
        canonicalRef: "main",
        canonicalRefType: "branch",
        canonicalPath: "skills/needs-review",
        sourcePath: "tests/fixtures/assets/sample-skill",
        riskTier: "T2",
        tags: [],
      });

      await expect(approveCapability(sandbox.root, "skill.vendor.needs-review")).rejects.toThrow(
        "review.status must be approved"
      );

      await mutateCapability(sandbox.root, "skill.vendor.needs-review", (capability) => {
        capability.lifecycleState = "approved";
        capability.review = {
          ...capability.review,
          status: "approved",
          reviewer: "Halvin",
          reviewedAt: FIXED_REVIEW_DATE,
          license: "MIT",
          executesScripts: true,
          networkAccess: true,
          touchesCredentials: false,
        };
      });

      await expect(publishGovernance(sandbox.root)).rejects.toThrow("hash.digest is required");
    } finally {
      await sandbox.cleanup();
    }
  });

  it("publishes and renders deterministic output for the same machine profile", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.sample-skill",
        runtimeTargets: ["codex", "cursor"],
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });

      const firstLock = await fs.readFile(path.join(sandbox.root, "locks", "resolution.lock.json"), "utf8");
      const firstSharedManifest = await fs.readFile(
        path.join(
          sandbox.root,
          "generated",
          "shared-cache",
          "manifests",
          "shared-cache-manifest.json"
        ),
        "utf8"
      );
      const firstRuntimeState = await fs.readFile(
        path.join(
          sandbox.root,
          "generated",
          "machines",
          sandbox.machineId,
          "codex",
          "desired-state.json"
        ),
        "utf8"
      );

      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });

      const secondLock = await fs.readFile(path.join(sandbox.root, "locks", "resolution.lock.json"), "utf8");
      const secondSharedManifest = await fs.readFile(
        path.join(
          sandbox.root,
          "generated",
          "shared-cache",
          "manifests",
          "shared-cache-manifest.json"
        ),
        "utf8"
      );
      const secondRuntimeState = await fs.readFile(
        path.join(
          sandbox.root,
          "generated",
          "machines",
          sandbox.machineId,
          "codex",
          "desired-state.json"
        ),
        "utf8"
      );

      expect(secondLock).toBe(firstLock);
      expect(secondSharedManifest).toBe(firstSharedManifest);
      expect(secondRuntimeState).toBe(firstRuntimeState);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("syncs Codex while preserving unmanaged model settings and native entries", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.codex-skill",
        runtimeTargets: ["codex"],
      });
      await preparePluginCapability(sandbox.root, {
        id: "plugin.vendor.codex-plugin",
        runtimeTargets: ["codex"],
        runtimeBindings: {
          codex: {
            plugin: {
              pluginId: "sample-plugin@governed-marketplace",
              enabled: true,
            },
          },
        },
      });
      await prepareMcpCapability(sandbox.root, {
        id: "mcp.vendor.codex-server",
        runtimeTargets: ["codex"],
        runtimeBindings: {
          codex: {
            mcp: {
              serverName: "governed",
              config: {
                command: "npx",
                args: ["-y", "governed-server"],
              },
            },
          },
        },
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "codex",
        bootstrap,
      });

      expect(await exists(path.join(sandbox.cacheRoot, "skills", "codex-skill", "SKILL.md"))).toBe(true);

      const configText = await fs.readFile(path.join(sandbox.home, ".codex", "config.toml"), "utf8");
      const config = TOML.parse(configText) as {
        model?: string;
        model_reasoning_effort?: string;
        plugins?: Record<string, { enabled?: boolean }>;
        mcp_servers?: Record<string, { command?: string }>;
      };

      expect(config.model).toBe("gpt-5.4");
      expect(config.model_reasoning_effort).toBe("high");
      expect(config.plugins?.["manual@vendor"]?.enabled).toBe(true);
      expect(config.plugins?.["sample-plugin@governed-marketplace"]?.enabled).toBe(true);
      expect(config.mcp_servers?.manual?.command).toBe("manual-server");
      expect(config.mcp_servers?.governed?.command).toBe("npx");
    } finally {
      await sandbox.cleanup();
    }
  });

  it("syncs Cursor MCP and user skills without writing into skills-cursor", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.cursor-skill",
        runtimeTargets: ["cursor"],
      });
      await prepareMcpCapability(sandbox.root, {
        id: "mcp.vendor.cursor-server",
        runtimeTargets: ["cursor"],
        runtimeBindings: {
          cursor: {
            mcp: {
              serverName: "governed-cursor",
              config: {
                command: "uvx",
                args: ["cursor-server"],
              },
            },
          },
        },
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "cursor",
        bootstrap,
      });

      expect(await exists(path.join(sandbox.home, ".cursor", "skills", "cursor-skill", "SKILL.md"))).toBe(true);
      expect(await exists(path.join(sandbox.home, ".cursor", "skills-cursor", "cursor-skill"))).toBe(false);

      const cursorConfig = JSON.parse(
        await fs.readFile(path.join(sandbox.home, ".cursor", "mcp.json"), "utf8")
      ) as {
        mcpServers: Record<string, { command?: string }>;
      };
      expect(cursorConfig.mcpServers.manual?.command).toBe("manual-cursor");
      expect(cursorConfig.mcpServers["governed-cursor"]?.command).toBe("uvx");
    } finally {
      await sandbox.cleanup();
    }
  });

  it("syncs Claude plugin settings and manifests while preserving unmanaged records", async () => {
    const sandbox = await createSandbox();

    try {
      await preparePluginCapability(sandbox.root, {
        id: "plugin.vendor.claude-plugin",
        runtimeTargets: ["claude"],
        runtimeBindings: {
          claude: {
            plugin: {
              pluginId: "sample-plugin@governed-marketplace",
              enabled: true,
              knownMarketplace: {
                marketplaceId: "governed-marketplace",
                source: "https://example.com/governed-marketplace",
                installLocation: "${CACHE_ROOT}/packages/sample-plugin",
                lastUpdated: FIXED_REVIEW_DATE,
              },
              installedRecords: [
                {
                  scope: "user",
                  installPath: "${CACHE_ROOT}/packages/sample-plugin",
                  version: "1.0.0",
                  installedAt: FIXED_REVIEW_DATE,
                  lastUpdated: FIXED_REVIEW_DATE,
                  gitCommitSha: "abc123",
                },
              ],
            },
          },
        },
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "claude",
        bootstrap,
      });

      const settings = JSON.parse(
        await fs.readFile(path.join(sandbox.home, ".claude", "settings.json"), "utf8")
      ) as {
        model?: string;
        enabledPlugins: Record<string, boolean>;
      };
      const known = JSON.parse(
        await fs.readFile(
          path.join(sandbox.home, ".claude", "plugins", "known_marketplaces.json"),
          "utf8"
        )
      ) as Record<string, Record<string, string>>;
      const installed = JSON.parse(
        await fs.readFile(
          path.join(sandbox.home, ".claude", "plugins", "installed_plugins.json"),
          "utf8"
        )
      ) as {
        version: number;
        plugins: Record<string, Array<Record<string, string>>>;
      };

      expect(settings.model).toBe("claude-sonnet-4.5");
      expect(settings.enabledPlugins["manual@vendor"]).toBe(true);
      expect(settings.enabledPlugins["sample-plugin@governed-marketplace"]).toBe(true);
      expect(known["manual-marketplace"]).toBeTruthy();
      expect(known["governed-marketplace"]?.installLocation).toBe(
        path.join(sandbox.cacheRoot, "packages", "sample-plugin")
      );
      expect(installed.plugins["manual@vendor"]).toHaveLength(1);
      expect(installed.plugins["sample-plugin@governed-marketplace"]?.[0]?.installPath).toBe(
        path.join(sandbox.cacheRoot, "packages", "sample-plugin")
      );
    } finally {
      await sandbox.cleanup();
    }
  });

  it("imports current local machine state into the repo and adopts it as managed", async () => {
    const sandbox = await createSandbox();

    try {
      await fs.mkdir(path.join(sandbox.cacheRoot, "skills"), { recursive: true });
      await fs.cp(
        path.join(REPO_ROOT, "tests", "fixtures", "assets", "sample-skill"),
        path.join(sandbox.cacheRoot, "skills", "sample-skill"),
        { recursive: true }
      );
      await fs.writeFile(
        path.join(sandbox.cacheRoot, ".skill-lock.json"),
        JSON.stringify(
          {
            version: 3,
            skills: {
              "sample-skill": {
                source: "example/sample-skill",
                sourceType: "github",
                sourceUrl: "https://github.com/example/sample-skill.git",
                skillPath: "skills/sample-skill/SKILL.md",
                skillFolderHash: "samplehash",
                installedAt: FIXED_REVIEW_DATE,
                updatedAt: FIXED_REVIEW_DATE,
              },
            },
          },
          null,
          2
        ),
        "utf8"
      );

      await fs.mkdir(path.join(sandbox.home, ".codex", ".tmp", "plugins", "plugins"), {
        recursive: true,
      });
      await fs.cp(
        path.join(REPO_ROOT, "tests", "fixtures", "assets", "sample-plugin"),
        path.join(sandbox.home, ".codex", ".tmp", "plugins", "plugins", "sample-plugin"),
        { recursive: true }
      );
      await fs.writeFile(
        path.join(sandbox.home, ".codex", "config.toml"),
        [
          'model = "gpt-5.4"',
          'model_reasoning_effort = "high"',
          "",
          '[plugins."sample-plugin@governed-marketplace"]',
          "enabled = true",
          "",
          "[mcp_servers.figma]",
          'url = "https://mcp.figma.com/mcp"',
          "",
        ].join("\n"),
        "utf8"
      );

      await fs.writeFile(
        path.join(sandbox.home, ".cursor", "mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              github: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-github"],
                env: {
                  GITHUB_TOKEN: "cursor-secret",
                },
              },
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const claudePluginRoot = path.join(
        sandbox.home,
        ".claude",
        "plugins",
        "marketplaces",
        "sample-marketplace"
      );
      await fs.mkdir(path.join(claudePluginRoot, ".claude-plugin"), { recursive: true });
      await fs.writeFile(
        path.join(claudePluginRoot, ".claude-plugin", "plugin.json"),
        JSON.stringify(
          {
            name: "sample-plugin",
            version: "1.0.0",
            license: "MIT",
          },
          null,
          2
        ),
        "utf8"
      );
      await fs.writeFile(
        path.join(sandbox.home, ".claude", "settings.json"),
        JSON.stringify(
          {
            model: "claude-sonnet-4.5",
            enabledPlugins: {
              "sample-plugin@sample-marketplace": true,
            },
          },
          null,
          2
        ),
        "utf8"
      );
      await fs.writeFile(
        path.join(sandbox.home, ".claude", "plugins", "known_marketplaces.json"),
        JSON.stringify(
          {
            "sample-marketplace": {
              source: {
                source: "github",
                repo: "example/sample-plugin",
              },
              installLocation: claudePluginRoot,
              lastUpdated: FIXED_REVIEW_DATE,
            },
          },
          null,
          2
        ),
        "utf8"
      );
      await fs.writeFile(
        path.join(sandbox.home, ".claude", "plugins", "installed_plugins.json"),
        JSON.stringify(
          {
            version: 2,
            plugins: {
              "sample-plugin@sample-marketplace": [
                {
                  scope: "user",
                  installPath: path.join(
                    sandbox.home,
                    ".claude",
                    "plugins",
                    "cache",
                    "sample-marketplace",
                    "sample-plugin",
                    "1.0.0"
                  ),
                  version: "1.0.0",
                  installedAt: FIXED_REVIEW_DATE,
                  lastUpdated: FIXED_REVIEW_DATE,
                  gitCommitSha: "sample123",
                },
              ],
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const bootstrap = await loadBootstrap(sandbox.bootstrapPath);
      const summary = await importLocalMachineState({
        root: sandbox.root,
        bootstrap,
        machineId: sandbox.machineId,
        reviewer: "Bootstrap Reviewer",
      });

      expect(summary.skillCount).toBe(1);
      expect(summary.pluginCount).toBe(2);
      expect(summary.mcpCount).toBe(2);
      expect(summary.skippedSkills).toEqual([]);
      expect(summary.syncedRuntimes).toEqual(["codex", "cursor", "claude"]);

      expect(
        await exists(path.join(sandbox.root, "registry", "capabilities", "skill.imported.sample-skill.yaml"))
      ).toBe(true);
      expect(
        await exists(
          path.join(sandbox.root, "registry", "capabilities", "plugin.imported.codex.sample-plugin.yaml")
        )
      ).toBe(true);
      expect(
        await exists(
          path.join(sandbox.root, "registry", "capabilities", "plugin.imported.claude.sample-plugin.yaml")
        )
      ).toBe(true);
      expect(
        await exists(path.join(sandbox.root, "registry", "capabilities", "mcp.imported.cursor.github.yaml"))
      ).toBe(true);

      const importedCursorMcp = await fs.readFile(
        path.join(sandbox.root, "registry", "capabilities", "mcp.imported.cursor.github.yaml"),
        "utf8"
      );
      expect(importedCursorMcp).toContain("${SECRET:IMPORTED_CURSOR_MCP_GITHUB_ENV_GITHUB_TOKEN}");
      expect(importedCursorMcp).not.toContain("cursor-secret");

      const localSecrets = YAML.parse(
        await fs.readFile(sandbox.localSecretsFile, "utf8")
      ) as {
        secrets: Record<string, string>;
      };
      expect(localSecrets.secrets.IMPORTED_CURSOR_MCP_GITHUB_ENV_GITHUB_TOKEN).toBe("cursor-secret");

      expect(await exists(path.join(sandbox.cacheRoot, "skills", "sample-skill", "SKILL.md"))).toBe(true);
      expect(
        await exists(path.join(sandbox.cacheRoot, "packages", "codex-sample-plugin", ".codex-plugin", "plugin.json"))
      ).toBe(true);
      expect(
        await exists(
          path.join(sandbox.cacheRoot, "packages", "claude-sample-plugin", ".claude-plugin", "plugin.json")
        )
      ).toBe(true);

      const cursorConfig = JSON.parse(
        await fs.readFile(path.join(sandbox.home, ".cursor", "mcp.json"), "utf8")
      ) as {
        mcpServers: Record<string, { env?: Record<string, string> }>;
      };
      expect(cursorConfig.mcpServers.github?.env?.GITHUB_TOKEN).toBe("cursor-secret");

      const codexState = JSON.parse(
        await fs.readFile(
          path.join(sandbox.home, ".config", "agent-governance", "state", sandbox.machineId, "codex.json"),
          "utf8"
        )
      ) as {
        managedPluginIds: string[];
      };
      expect(codexState.managedPluginIds).toEqual(["sample-plugin@governed-marketplace"]);

      const sources = YAML.parse(
        await fs.readFile(path.join(sandbox.root, "registry", "sources.yaml"), "utf8")
      ) as {
        sources: Array<{ id: string }>;
      };
      expect(sources.sources.some((source) => source.id === "governance-repo")).toBe(true);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("dereferences imported assets and skips invalid local skills during import-local", async () => {
    const sandbox = await createSandbox();

    try {
      const validSkillDir = path.join(sandbox.cacheRoot, "skills", "linked-skill");
      await fs.mkdir(validSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(validSkillDir, "SKILL.md"),
        "# Linked Skill\n\nA valid skill fixture.\n",
        "utf8"
      );

      const externalSkillNote = path.join(sandbox.home, "external-skill-note.md");
      await fs.writeFile(externalSkillNote, "external skill note\n", "utf8");
      await fs.symlink(externalSkillNote, path.join(validSkillDir, "notes.md"));

      const invalidSkillDir = path.join(sandbox.cacheRoot, "skills", "invalid-skill");
      await fs.mkdir(invalidSkillDir, { recursive: true });
      await fs.writeFile(path.join(invalidSkillDir, "README.md"), "missing skill entry\n", "utf8");

      const codexPluginDir = path.join(
        sandbox.home,
        ".codex",
        ".tmp",
        "plugins",
        "plugins",
        "linked-plugin"
      );
      await fs.mkdir(path.join(codexPluginDir, ".codex-plugin"), { recursive: true });
      await fs.writeFile(
        path.join(codexPluginDir, ".codex-plugin", "plugin.json"),
        JSON.stringify(
          {
            name: "linked-plugin",
            version: "1.0.0",
            license: "MIT",
          },
          null,
          2
        ),
        "utf8"
      );

      const externalPluginNote = path.join(sandbox.home, "external-plugin-note.txt");
      await fs.writeFile(externalPluginNote, "external plugin note\n", "utf8");
      await fs.symlink(externalPluginNote, path.join(codexPluginDir, "notes.txt"));

      await fs.writeFile(
        path.join(sandbox.home, ".codex", "config.toml"),
        ['[plugins."linked-plugin@governed-marketplace"]', "enabled = true", ""].join("\n"),
        "utf8"
      );
      await fs.writeFile(
        path.join(sandbox.home, ".cursor", "mcp.json"),
        JSON.stringify({ mcpServers: {} }, null, 2),
        "utf8"
      );
      await fs.writeFile(
        path.join(sandbox.home, ".claude", "settings.json"),
        JSON.stringify(
          {
            enabledPlugins: {},
          },
          null,
          2
        ),
        "utf8"
      );
      await fs.writeFile(
        path.join(sandbox.home, ".claude", "plugins", "known_marketplaces.json"),
        JSON.stringify({}, null, 2),
        "utf8"
      );
      await fs.writeFile(
        path.join(sandbox.home, ".claude", "plugins", "installed_plugins.json"),
        JSON.stringify({ version: 2, plugins: {} }, null, 2),
        "utf8"
      );

      const bootstrap = await loadBootstrap(sandbox.bootstrapPath);
      const summary = await importLocalMachineState({
        root: sandbox.root,
        bootstrap,
        machineId: sandbox.machineId,
        reviewer: "Bootstrap Reviewer",
        syncRuntimes: false,
      });

      expect(summary.skillCount).toBe(1);
      expect(summary.pluginCount).toBe(1);
      expect(summary.mcpCount).toBe(0);
      expect(summary.skippedSkills).toEqual(["invalid-skill"]);
      expect(summary.syncedRuntimes).toEqual([]);

      const importedSkillNote = path.join(
        sandbox.root,
        "assets",
        "skills",
        "linked-skill",
        "notes.md"
      );
      const importedPluginNote = path.join(
        sandbox.root,
        "assets",
        "packages",
        "codex-linked-plugin",
        "notes.txt"
      );

      expect((await fs.lstat(importedSkillNote)).isSymbolicLink()).toBe(false);
      expect((await fs.lstat(importedPluginNote)).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(importedSkillNote, "utf8")).toBe("external skill note\n");
      expect(await fs.readFile(importedPluginNote, "utf8")).toBe("external plugin note\n");
      expect(await exists(path.join(sandbox.root, "assets", "skills", "invalid-skill"))).toBe(false);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("fails sync when a required secret is missing", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareMcpCapability(sandbox.root, {
        id: "mcp.vendor.secret-server",
        runtimeTargets: ["codex"],
        runtimeBindings: {
          codex: {
            mcp: {
              serverName: "secret-server",
              config: {
                command: "npx",
                env: {
                  API_TOKEN: "${SECRET:API_TOKEN}",
                },
              },
            },
          },
        },
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });

      await expect(
        syncGovernance({
          root: sandbox.root,
          machineId: sandbox.machineId,
          runtimeId: "codex",
          bootstrap,
        })
      ).rejects.toThrow("Missing required secret API_TOKEN");
    } finally {
      await sandbox.cleanup();
    }
  });

  it("fails publish when a copy skill asset is missing SKILL.md", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.invalid-skill",
        runtimeTargets: ["codex"],
      });

      const invalidSkillDir = path.join(sandbox.root, "tests", "fixtures", "assets", "invalid-skill");
      await fs.mkdir(invalidSkillDir, { recursive: true });
      await fs.writeFile(path.join(invalidSkillDir, "README.md"), "missing skill entry\n", "utf8");

      await mutateCapability(sandbox.root, "skill.vendor.invalid-skill", (capability) => {
        capability.install.sourcePath = "tests/fixtures/assets/invalid-skill";
      });

      await expect(publishGovernance(sandbox.root)).rejects.toThrow("skill assets must include SKILL.md");
    } finally {
      await sandbox.cleanup();
    }
  });

  it("flags absolute symlinks in copy assets during publish and audit", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.symlink-skill",
        runtimeTargets: ["codex"],
      });

      const symlinkSkillDir = path.join(sandbox.root, "tests", "fixtures", "assets", "symlink-skill");
      await fs.mkdir(symlinkSkillDir, { recursive: true });
      await fs.writeFile(path.join(symlinkSkillDir, "SKILL.md"), "# Symlink Skill\n", "utf8");

      const externalFile = path.join(sandbox.root, "tests", "fixtures", "assets", "external-note.md");
      await fs.writeFile(externalFile, "absolute symlink target\n", "utf8");
      await fs.symlink(externalFile, path.join(symlinkSkillDir, "notes.md"));

      await mutateCapability(sandbox.root, "skill.vendor.symlink-skill", (capability) => {
        capability.install.sourcePath = "tests/fixtures/assets/symlink-skill";
      });

      await expect(publishGovernance(sandbox.root)).rejects.toThrow("copy asset contains absolute symlink");

      const findings = await auditGovernance(sandbox.root, {
        staleDays: 3650,
        checkUpstream: false,
      });
      expect(findings.some((finding) => finding.includes("copy asset contains absolute symlink"))).toBe(
        true
      );
    } finally {
      await sandbox.cleanup();
    }
  });

  it("removes deprecated capabilities from runtime state and shared cache after republish", async () => {
    const sandbox = await createSandbox();

    try {
      const capabilityId = "skill.vendor.deprecated-skill";
      await prepareSkillCapability(sandbox.root, {
        id: capabilityId,
        runtimeTargets: ["cursor"],
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "cursor",
        bootstrap,
      });

      expect(
        await exists(path.join(sandbox.cacheRoot, "skills", "deprecated-skill", "SKILL.md"))
      ).toBe(true);
      expect(
        await exists(path.join(sandbox.home, ".cursor", "skills", "deprecated-skill", "SKILL.md"))
      ).toBe(true);

      await changeCapabilityLifecycle(sandbox.root, capabilityId, "deprecated", "Superseded");
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "cursor",
        bootstrap,
      });

      expect(await exists(path.join(sandbox.cacheRoot, "skills", "deprecated-skill"))).toBe(false);
      expect(await exists(path.join(sandbox.home, ".cursor", "skills", "deprecated-skill"))).toBe(
        false
      );
    } finally {
      await sandbox.cleanup();
    }
  });

  it("restores runtime and shared cache state from a historical lock snapshot", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.first-skill",
        runtimeTargets: ["codex"],
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      const firstSnapshot = await latestSnapshotPath(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "codex",
        bootstrap,
      });

      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.second-skill",
        runtimeTargets: ["codex"],
      });
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "codex",
        bootstrap,
      });

      expect(await exists(path.join(sandbox.cacheRoot, "skills", "first-skill", "SKILL.md"))).toBe(true);
      expect(await exists(path.join(sandbox.cacheRoot, "skills", "second-skill", "SKILL.md"))).toBe(
        true
      );

      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
        lockFile: firstSnapshot,
      });
      await syncGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        runtimeId: "codex",
        bootstrap,
      });

      expect(await exists(path.join(sandbox.cacheRoot, "skills", "first-skill", "SKILL.md"))).toBe(true);
      expect(await exists(path.join(sandbox.cacheRoot, "skills", "second-skill"))).toBe(false);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("prunes unexpected generated top-level directories during render", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.generated-cleanup",
        runtimeTargets: ["codex"],
      });

      await fs.mkdir(path.join(sandbox.root, "generated", "claude"), { recursive: true });
      await fs.writeFile(path.join(sandbox.root, "generated", "claude", "stale.txt"), "stale\n", "utf8");

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });

      expect(await exists(path.join(sandbox.root, "generated", "claude"))).toBe(false);
      expect(await exists(path.join(sandbox.root, "generated", "shared-cache"))).toBe(true);
      expect(
        await exists(path.join(sandbox.root, "generated", "machines", sandbox.machineId, "codex"))
      ).toBe(true);
    } finally {
      await sandbox.cleanup();
    }
  });

  it("fails closed on unmanaged native config collisions", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareMcpCapability(sandbox.root, {
        id: "mcp.vendor.manual-collision",
        runtimeTargets: ["cursor"],
        runtimeBindings: {
          cursor: {
            mcp: {
              serverName: "manual",
              config: {
                command: "governed-cursor",
              },
            },
          },
        },
      });

      const bootstrap = await loadBootstrapFromDefaultPath();
      await publishGovernance(sandbox.root);
      await renderGovernance({
        root: sandbox.root,
        machineId: sandbox.machineId,
        bootstrap,
      });

      await expect(
        syncGovernance({
          root: sandbox.root,
          machineId: sandbox.machineId,
          runtimeId: "cursor",
          bootstrap,
        })
      ).rejects.toThrow("Cursor MCP server collision");
    } finally {
      await sandbox.cleanup();
    }
  });

  it("detects lock drift during audit after registry mutation", async () => {
    const sandbox = await createSandbox();

    try {
      await prepareSkillCapability(sandbox.root, {
        id: "skill.vendor.audit-skill",
        runtimeTargets: ["codex"],
      });
      await publishGovernance(sandbox.root);

      await mutateCapability(sandbox.root, "skill.vendor.audit-skill", (capability) => {
        capability.tags.push("mutated-after-publish");
      });

      const findings = await auditGovernance(sandbox.root, {
        staleDays: 90,
        checkUpstream: false,
      });

      expect(findings.some((finding) => finding.includes("Lock drift"))).toBe(true);
    } finally {
      await sandbox.cleanup();
    }
  });
});

async function createSandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-governance-"));
  const repoRoot = path.join(root, "repo");
  const home = path.join(root, "home");
  const machineId = "test-mac";
  const cacheRoot = path.join(home, ".agents");
  const bootstrapPath = path.join(home, ".config", "agent-governance", "bootstrap.yaml");
  const localSecretsFile = path.join(
    home,
    ".config",
    "agent-governance",
    "local",
    `${machineId}.yaml`
  );
  const originalHome = process.env.HOME;

  process.env.HOME = home;

  await fs.mkdir(path.join(repoRoot, "registry", "capabilities"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "runtimes"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "machines"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "generated"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "locks", "history"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "tests", "fixtures", "assets"), { recursive: true });
  await fs.mkdir(path.join(home, ".config", "agent-governance", "local"), { recursive: true });
  await fs.mkdir(path.join(home, ".config", "agent-governance", "state", machineId), {
    recursive: true,
  });
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  await fs.mkdir(path.join(home, ".cursor", "skills-cursor"), { recursive: true });
  await fs.mkdir(path.join(home, ".claude", "plugins"), { recursive: true });

  await copyIntoSandbox("registry/sources.yaml", repoRoot);
  await copyIntoSandbox("runtimes/codex.yaml", repoRoot);
  await copyIntoSandbox("runtimes/cursor.yaml", repoRoot);
  await copyIntoSandbox("runtimes/claude.yaml", repoRoot);
  await copyIntoSandbox("runtimes/gemini.yaml", repoRoot);
  await copyIntoSandbox("tests/fixtures/assets/sample-skill", repoRoot);
  await copyIntoSandbox("tests/fixtures/assets/sample-plugin", repoRoot);

  await fs.writeFile(
    path.join(repoRoot, "machines", `${machineId}.yaml`),
    YAML.stringify({
      machineId,
      description: "Test machine",
      workspaceRoot: path.join(home, "workspace"),
      enabledRuntimes: ["codex", "cursor", "claude"],
      pathVars: {},
      runtimeTargets: {
        codex: {
          nativeFiles: {},
          cacheBindings: {},
        },
        cursor: {
          nativeFiles: {},
          cacheBindings: {},
        },
        claude: {
          nativeFiles: {},
          cacheBindings: {},
        },
      },
      runtimeOverrides: {},
    }),
    "utf8"
  );

  await fs.writeFile(
    bootstrapPath,
    YAML.stringify({
      repoPath: repoRoot,
      machineId,
      cacheRoot,
      localSecretsFile,
    }),
    "utf8"
  );
  await fs.writeFile(
    localSecretsFile,
    YAML.stringify({
      secrets: {},
      runtimeLocalOverrides: {},
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(repoRoot, "locks", "resolution.lock.json"),
    JSON.stringify({ version: 2, generatedAt: null, capabilities: [] }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(home, ".codex", "config.toml"),
    [
      'model = "gpt-5.4"',
      'model_reasoning_effort = "high"',
      "",
      '[plugins."manual@vendor"]',
      "enabled = true",
      "",
      "[mcp_servers.manual]",
      'command = "manual-server"',
      "",
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(home, ".cursor", "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          manual: {
            command: "manual-cursor",
          },
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify(
      {
        model: "claude-sonnet-4.5",
        enabledPlugins: {
          "manual@vendor": true,
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(home, ".claude", "plugins", "known_marketplaces.json"),
    JSON.stringify(
      {
        "manual-marketplace": {
          source: "https://example.com/manual-marketplace",
          installLocation: "/tmp/manual-marketplace",
          lastUpdated: FIXED_REVIEW_DATE,
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify(
      {
        version: 2,
        plugins: {
          "manual@vendor": [
            {
              scope: "user",
              installPath: "/tmp/manual-plugin",
              version: "1.0.0",
              installedAt: FIXED_REVIEW_DATE,
              lastUpdated: FIXED_REVIEW_DATE,
              gitCommitSha: "manual123",
            },
          ],
        },
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    root: repoRoot,
    home,
    machineId,
    cacheRoot,
    bootstrapPath,
    localSecretsFile,
    cleanup: async () => {
      process.env.HOME = originalHome;
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function copyIntoSandbox(relativePath: string, repoRoot: string) {
  await fs.cp(path.join(REPO_ROOT, relativePath), path.join(repoRoot, relativePath), {
    recursive: true,
  });
}

async function loadBootstrapFromDefaultPath() {
  const context = await resolveContext();
  if (!context.bootstrap) {
    throw new Error("Expected default bootstrap to be available in the test sandbox.");
  }
  return context.bootstrap;
}

async function prepareSkillCapability(
  root: string,
  options: {
    id: string;
    runtimeTargets: string[];
  }
) {
  await ingestCapability(root, {
    id: options.id,
    name: options.id.split(".").at(-1) ?? options.id,
    assetKind: "skill",
    runtimeTargets: options.runtimeTargets,
    discoverySources: ["awesome-skills"],
    canonicalSourceId: "github-direct",
    canonicalUrl: "https://github.com/example/sample-skill",
    canonicalRef: "main",
    canonicalRefType: "branch",
    canonicalPath: "skills/sample-skill",
    sourcePath: "tests/fixtures/assets/sample-skill",
    riskTier: "T1",
    tags: ["test"],
  });

  await reviewCapability(root, options.id, {
    reviewer: "Test Reviewer",
    reviewedAt: FIXED_REVIEW_DATE,
    license: "MIT",
    status: "approved",
    executesScripts: false,
    networkAccess: false,
    touchesCredentials: false,
    notes: ["fixture approved"],
    hydrateHash: true,
  });
  await approveCapability(root, options.id);
}

async function preparePluginCapability(
  root: string,
  options: {
    id: string;
    runtimeTargets: string[];
    runtimeBindings: Record<string, unknown>;
  }
) {
  await ingestCapability(root, {
    id: options.id,
    name: options.id.split(".").at(-1) ?? options.id,
    assetKind: "plugin",
    runtimeTargets: options.runtimeTargets,
    discoverySources: ["awesome-skills"],
    canonicalSourceId: "github-direct",
    canonicalUrl: "https://github.com/example/sample-plugin",
    canonicalRef: "main",
    canonicalRefType: "branch",
    canonicalPath: "plugins/sample-plugin",
    sourcePath: "tests/fixtures/assets/sample-plugin",
    riskTier: "T1",
    tags: ["test"],
  });

  await mutateCapability(root, options.id, (capability) => {
    capability.runtimeBindings = options.runtimeBindings;
  });

  await reviewCapability(root, options.id, {
    reviewer: "Test Reviewer",
    reviewedAt: FIXED_REVIEW_DATE,
    license: "MIT",
    status: "approved",
    executesScripts: false,
    networkAccess: false,
    touchesCredentials: false,
    notes: ["fixture approved"],
    hydrateHash: true,
  });
  await approveCapability(root, options.id);
}

async function prepareMcpCapability(
  root: string,
  options: {
    id: string;
    runtimeTargets: string[];
    runtimeBindings: Record<string, unknown>;
  }
) {
  await ingestCapability(root, {
    id: options.id,
    name: options.id.split(".").at(-1) ?? options.id,
    assetKind: "mcp",
    runtimeTargets: options.runtimeTargets,
    discoverySources: ["awesome-skills"],
    canonicalSourceId: "github-direct",
    canonicalUrl: "https://github.com/example/sample-mcp",
    canonicalRef: "main",
    canonicalRefType: "branch",
    canonicalPath: "mcps/sample-mcp",
    sourcePath: "tests/fixtures/assets/sample-plugin",
    riskTier: "T1",
    tags: ["test"],
  });

  await mutateCapability(root, options.id, (capability) => {
    capability.runtimeBindings = options.runtimeBindings;
  });

  await reviewCapability(root, options.id, {
    reviewer: "Test Reviewer",
    reviewedAt: FIXED_REVIEW_DATE,
    license: "MIT",
    status: "approved",
    executesScripts: false,
    networkAccess: true,
    touchesCredentials: false,
    notes: ["fixture approved"],
    hydrateHash: true,
  });
  await approveCapability(root, options.id);
}

async function mutateCapability(
  root: string,
  id: string,
  mutate: (capability: Record<string, any>) => void
) {
  const filePath = path.join(root, "registry", "capabilities", `${id}.yaml`);
  const capability = YAML.parse(await fs.readFile(filePath, "utf8")) as Record<string, any>;
  mutate(capability);
  await fs.writeFile(filePath, YAML.stringify(capability), "utf8");
}

async function latestSnapshotPath(root: string) {
  const historyDir = path.join(root, "locks", "history");
  const entries = await fs.readdir(historyDir);
  return path.join(historyDir, entries.sort().at(-1)!);
}

async function exists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
