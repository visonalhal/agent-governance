import { z } from "zod";

// The schema module is the shared vocabulary for the whole repo.
// Read this file first when you need to re-establish what the core records mean.

export const lifecycleStates = [
  "candidate",
  "under_review",
  "approved",
  "published",
  "deprecated",
  "blocked",
] as const;

export const assetKinds = ["skill", "plugin", "mcp", "command", "agent"] as const;
export const runtimeProfileModes = ["managed", "review_only"] as const;
export const refTypes = ["branch", "tag", "commit"] as const;
export const riskTiers = ["T0", "T1", "T2", "T3"] as const;
export const skillBindingIds = ["cache", "user-dir"] as const;
export const mcpBindingIds = ["remote-http", "stdio-command"] as const;
export const pluginBindingIds = ["package", "marketplace", "external"] as const;
export const activationPhases = [
  "entry",
  "product",
  "planning",
  "design",
  "implementation",
  "tdd",
  "unit-testing",
  "web-qa",
  "e2e",
  "debugging",
  "review",
  "verification",
  "governance",
  "tool",
] as const;
export const triggerModes = [
  "default",
  "explicit",
  "project-explicit",
  "reference-only",
  "blocked",
] as const;
export const subagentRoles = [
  "none",
  "researcher",
  "implementer",
  "reviewer",
  "qa-runner",
  "debugger",
  "skill-auditor",
] as const;

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const sourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["catalog", "repo", "package"]),
  url: z.url(),
  discoveryOnly: z.boolean(),
  trustLevel: z.string().min(1),
  owner: z.string().min(1),
  notes: z.array(z.string()).default([]),
});

export const sourcesFileSchema = z.object({
  sources: z.array(sourceSchema).default([]),
});

export const installSchema = z.object({
  strategy: z.enum(["copy", "manifest", "external"]).default("copy"),
  artifactName: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  manifest: jsonObjectSchema.optional(),
});

export const permissionSchema = z.object({
  localRead: z.enum(["none", "scoped", "full"]).default("none"),
  network: z.boolean().default(false),
  credentials: z.boolean().default(false),
  filesystemWrite: z.enum(["none", "runtime-only", "full"]).default("none"),
});

export const reviewSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  reviewer: z.string().min(1).optional(),
  reviewedAt: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  executesScripts: z.boolean().optional(),
  networkAccess: z.boolean().optional(),
  touchesCredentials: z.boolean().optional(),
  filesystemSideEffects: z.string().min(1).optional(),
  notes: z.array(z.string()).default([]),
});

export const canonicalSourceSchema = z.object({
  sourceId: z.string().min(1),
  url: z.url(),
  ref: z.string().min(1),
  refType: z.enum(refTypes).default("commit"),
  path: z.string().min(1),
  resolvedRevision: z.string().min(1).optional(),
});

export const versionPolicySchema = z.object({
  strategy: z.literal("pin-ref-and-hash").default("pin-ref-and-hash"),
  allowUpdates: z.literal("manual").default("manual"),
});

export const hashSchema = z.object({
  algorithm: z.literal("sha256").default("sha256"),
  digest: z.string().min(1).optional(),
});

export const runtimeSkillBindingSchema = z.object({
  syncMode: z.enum(["cache-only", "user-skill-dir", "config-path"]).default("cache-only"),
});

export const runtimePluginBindingSchema = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean().default(true),
  adoptExisting: z.boolean().default(false),
  marketplaceId: z.string().min(1).optional(),
  knownMarketplace: jsonObjectSchema.optional(),
  installedRecords: z.array(jsonObjectSchema).default([]),
});

export const runtimeMcpBindingSchema = z.object({
  serverName: z.string().min(1),
  config: jsonObjectSchema,
  adoptExisting: z.boolean().default(false),
});

export const legacyRuntimeBindingSchema = z.object({
  skill: runtimeSkillBindingSchema.optional(),
  plugin: runtimePluginBindingSchema.optional(),
  mcp: runtimeMcpBindingSchema.optional(),
});

export const pluginInstallBindingSchema = z.object({
  install: installSchema,
  nativeRegistration: runtimePluginBindingSchema,
});

export const capabilityBindingSchema = z.object({
  skill: runtimeSkillBindingSchema.optional(),
  plugin: pluginInstallBindingSchema.optional(),
  mcp: runtimeMcpBindingSchema.optional(),
});

export const pluginEntrypointsSchema = z.object({
  commands: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
});

export const activationSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    phase: z.enum(activationPhases).default("implementation"),
    triggerMode: z.enum(triggerModes).default("explicit"),
    maxChainDepth: z.number().int().min(0).default(1),
    conflictsWith: z.array(z.string().min(1)).default([]),
    replaces: z.array(z.string().min(1)).default([]),
    projectScopes: z.array(z.string().min(1)).default([]),
    subagentRole: z.enum(subagentRoles).default("none"),
    activationExamples: z.array(z.string().min(1)).default([]),
    antiTriggers: z.array(z.string().min(1)).default([]),
  })
);

export const capabilitySchema = z.object({
  id: z.string().regex(/^(skill|plugin|mcp|command|agent)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/),
  name: z.string().min(1),
  assetKind: z.enum(assetKinds),
  bindings: z.record(z.string().min(1), capabilityBindingSchema).default({}),
  discoverySources: z.array(z.string().min(1)).default([]),
  includes: z.array(z.string().min(1)).default([]),
  entrypoints: pluginEntrypointsSchema.optional(),
  exposes: z.array(z.string().min(1)).default([]),
  canonicalSource: canonicalSourceSchema,
  install: installSchema,
  riskTier: z.enum(riskTiers),
  permissions: permissionSchema.default({
    localRead: "none",
    network: false,
    credentials: false,
    filesystemWrite: "none",
  }),
  review: reviewSchema.default({
    status: "pending",
    notes: [],
  }),
  lifecycleState: z.enum(lifecycleStates).default("candidate"),
  activation: activationSchema,
  versionPolicy: versionPolicySchema.default({
    strategy: "pin-ref-and-hash",
    allowUpdates: "manual",
  }),
  hash: hashSchema.default({
    algorithm: "sha256",
  }),
  tags: z.array(z.string()).default([]),
  statusReason: z.string().min(1).optional(),
});

export const pathBindingSchema = z.object({
  name: z.string().min(1),
  template: z.string().min(1),
});

export const runtimeBindingDefaultsSchema = z.object({
  skill: z.array(z.enum(skillBindingIds)).default([]),
  mcp: z.array(z.enum(mcpBindingIds)).default([]),
  plugin: z.array(z.enum(pluginBindingIds)).default([]),
});

export const runtimeBindingPolicySchema = z.object({
  defaults: runtimeBindingDefaultsSchema.default({
    skill: [],
    mcp: [],
    plugin: [],
  }),
  overrides: z.record(z.string(), z.union([z.string().min(1), z.literal("disabled")])).default({}),
});

export const runtimeSchema = z.object({
  runtimeId: z.string().min(1),
  supportedAssetKinds: z.array(z.enum(assetKinds)).default([]),
  enabledCapabilities: z.array(z.string().min(1)).default([]),
  bindingPolicy: runtimeBindingPolicySchema.default({
    defaults: {
      skill: [],
      mcp: [],
      plugin: [],
    },
    overrides: {},
  }),
  nativeFiles: z.array(pathBindingSchema).default([]),
  cacheBindings: z.array(pathBindingSchema).default([]),
  mergeStrategy: z.enum(["codex-toml", "cursor-json", "claude-json", "noop"]),
  ownedStateFile: z.string().min(1),
  profileMode: z.enum(runtimeProfileModes),
  notes: z.array(z.string()).default([]),
});

export const runtimeProfileSchema = z.object({
  profileId: z.string().min(1),
  runtimeId: z.string().min(1),
  enabledCapabilities: z.array(z.string().min(1)).default([]),
  referenceCapabilities: z.array(z.string().min(1)).default([]),
  blockedCapabilities: z.array(z.string().min(1)).default([]),
  projectScopes: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string()).default([]),
});

export const machineRuntimeTargetSchema = z.object({
  nativeFiles: z.record(z.string(), z.string()).default({}),
  cacheBindings: z.record(z.string(), z.string()).default({}),
});

export const runtimeAuditAllowlistSchema = z.object({
  plugins: z.array(z.string().min(1)).default([]),
  mcpServers: z.array(z.string().min(1)).default([]),
  userSkills: z.array(z.string().min(1)).default([]),
  remotePlugins: z.array(z.string().min(1)).default([]),
  auditRemotePlugins: z.boolean().default(false),
});

export const machineSchema = z.object({
  machineId: z.string().min(1),
  description: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1),
  enabledRuntimes: z.array(z.string().min(1)).default([]),
  activeProfiles: z.array(z.string().min(1)).default([]),
  pathVars: z.record(z.string(), z.string()).default({}),
  runtimeTargets: z.record(z.string(), machineRuntimeTargetSchema).default({}),
  runtimeOverrides: z.record(z.string(), jsonValueSchema).default({}),
  runtimeAuditAllowlist: z.record(z.string(), runtimeAuditAllowlistSchema).default({}),
});

export const bootstrapSchema = z.object({
  repoPath: z.string().min(1),
  machineId: z.string().min(1),
  cacheRoot: z.string().min(1),
  localSecretsFile: z.string().min(1),
});

export const localSecretsSchema = z.object({
  secrets: z.record(z.string(), z.string()).default({}),
  runtimeLocalOverrides: z.record(z.string(), jsonValueSchema).default({}),
});

export const lockCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  assetKind: z.enum(assetKinds),
  riskTier: z.enum(riskTiers),
  bindings: z.record(z.string(), capabilityBindingSchema).default({}),
  includes: z.array(z.string().min(1)).default([]),
  entrypoints: pluginEntrypointsSchema.optional(),
  exposes: z.array(z.string().min(1)).default([]),
  canonicalSource: canonicalSourceSchema,
  install: installSchema,
  hash: hashSchema,
  activation: activationSchema,
  tags: z.array(z.string()).default([]),
});

export const resolutionLockSchema = z.object({
  version: z.literal(3),
  generatedAt: z.string().nullable(),
  capabilities: z.array(lockCapabilitySchema).default([]),
});

export const legacyLockCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  assetKind: z.enum(assetKinds),
  riskTier: z.enum(riskTiers),
  runtimeTargets: z.array(z.string()).default([]),
  runtimeBindings: z.record(z.string(), legacyRuntimeBindingSchema).default({}),
  includes: z.array(z.string().min(1)).default([]),
  entrypoints: pluginEntrypointsSchema.optional(),
  exposes: z.array(z.string().min(1)).default([]),
  canonicalSource: canonicalSourceSchema,
  install: installSchema,
  hash: hashSchema,
  tags: z.array(z.string()).default([]),
});

export const legacyLockDistributionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtimeId: z.string().min(1),
  pluginId: z.string().min(1),
  canonicalSource: canonicalSourceSchema,
  install: installSchema,
  nativeRegistration: runtimePluginBindingSchema,
  hash: hashSchema,
  tags: z.array(z.string()).default([]),
});

export const legacyResolutionLockSchema = z.object({
  version: z.literal(2),
  generatedAt: z.string().nullable(),
  capabilities: z.array(legacyLockCapabilitySchema).default([]),
  distributions: z.array(legacyLockDistributionSchema).default([]),
});

export const renderedSkillStateSchema = z.object({
  id: z.string().min(1),
  bindingId: z.string().min(1),
  artifactName: z.string().min(1),
  cacheRelativePath: z.string().min(1),
  syncMode: z.enum(["cache-only", "user-skill-dir", "config-path"]),
});

export const renderedPluginStateSchema = z.object({
  id: z.string().min(1),
  bindingId: z.string().min(1),
  artifactName: z.string().min(1),
  cacheRelativePath: z.string().min(1).optional(),
  nativeRegistration: runtimePluginBindingSchema,
});

export const renderedMcpStateSchema = z.object({
  id: z.string().min(1),
  bindingId: z.string().min(1),
  serverName: z.string().min(1),
  config: jsonObjectSchema,
  adoptExisting: z.boolean().default(false),
});

export const renderedRuntimeStateSchema = z.object({
  machineId: z.string().min(1),
  runtimeId: z.string().min(1),
  generatedAt: z.string().nullable(),
  profileMode: z.enum(runtimeProfileModes),
  nativeFiles: z.record(z.string(), z.string()),
  cacheBindings: z.record(z.string(), z.string()),
  ownedStateFile: z.string().min(1),
  skills: z.array(renderedSkillStateSchema).default([]),
  plugins: z.array(renderedPluginStateSchema).default([]),
  mcps: z.array(renderedMcpStateSchema).default([]),
});

export const renderedProjectRuntimeStateSchema = z.object({
  projectScope: z.string().min(1),
  state: renderedRuntimeStateSchema,
});

export const renderedProjectRuntimeStatesSchema = z
  .array(renderedProjectRuntimeStateSchema)
  .default([]);

export const runtimeAuditSnapshotSchema = z.object({
  machineId: z.string().min(1),
  runtimeId: z.string().min(1),
  generatedAt: z.string().nullable(),
  actual: z.object({
    configPath: z.string().min(1),
    globalAgentsPath: z.string().min(1),
    globalAgentsDigest: z.string().min(1).optional(),
    userSkillsDir: z.string().min(1),
    pluginCacheDir: z.string().min(1),
    plugins: z.record(z.string(), z.object({ enabled: z.boolean() })),
    remotePlugins: z.record(
      z.string(),
      z.object({
        installed: z.boolean(),
        enabled: z.boolean(),
        displayName: z.string().optional(),
        version: z.string().optional(),
      })
    ),
    remotePluginAuditError: z.string().optional(),
    mcpServers: z.array(z.string()).default([]),
    userSkills: z.array(z.string()).default([]),
    pluginSkills: z.array(
      z.object({
        pluginId: z.string().min(1),
        root: z.string().min(1),
        skills: z.array(z.string().min(1)).default([]),
      })
    ),
  }),
  desired: z.object({
    globalAgentsSourcePath: z.string().min(1),
    globalAgentsDigest: z.string().min(1),
    plugins: z.record(z.string(), z.object({ enabled: z.boolean() })),
    mcpServers: z.array(z.string()).default([]),
    userSkills: z.array(z.string()).default([]),
    remotePlugins: z.array(z.string()).default([]),
  }),
  projects: z
    .array(
      z.object({
        projectScope: z.string().min(1),
        actual: z.object({
          configPath: z.string().min(1),
          trusted: z.boolean(),
          plugins: z.record(z.string(), z.object({ enabled: z.boolean() })),
          mcpServers: z.array(z.string()).default([]),
          skills: z.record(z.string(), z.object({ enabled: z.boolean() })),
        }),
        desired: z.object({
          trusted: z.boolean(),
          plugins: z.record(z.string(), z.object({ enabled: z.boolean() })),
          mcpServers: z.array(z.string()).default([]),
          skills: z.record(z.string(), z.object({ enabled: z.boolean() })),
        }),
      })
    )
    .default([]),
  findings: z.array(z.string()).default([]),
});

export const sharedCacheManifestSchema = z.object({
  generatedAt: z.string().nullable(),
  skills: z.array(
    z.object({
      id: z.string().min(1),
      artifactName: z.string().min(1),
      sourcePath: z.string().min(1),
      relativePath: z.string().min(1),
    })
  ),
  packages: z.array(
    z.object({
      id: z.string().min(1),
      runtimeId: z.string().min(1),
      bindingId: z.string().min(1),
      artifactName: z.string().min(1),
      sourcePath: z.string().min(1),
      relativePath: z.string().min(1),
    })
  ),
});

export type SourceRecord = z.infer<typeof sourceSchema>;
export type CapabilityRecord = z.infer<typeof capabilitySchema>;
export type RuntimeRecord = z.infer<typeof runtimeSchema>;
export type RuntimeProfileRecord = z.infer<typeof runtimeProfileSchema>;
export type MachineRecord = z.infer<typeof machineSchema>;
export type BootstrapRecord = z.infer<typeof bootstrapSchema>;
export type LocalSecretsRecord = z.infer<typeof localSecretsSchema>;
export type ResolutionLock = z.infer<typeof resolutionLockSchema>;
export type LegacyResolutionLock = z.infer<typeof legacyResolutionLockSchema>;
export type AnyResolutionLock = ResolutionLock | LegacyResolutionLock;
export type RenderedRuntimeState = z.infer<typeof renderedRuntimeStateSchema>;
export type RenderedProjectRuntimeState = z.infer<typeof renderedProjectRuntimeStateSchema>;
export type RuntimeAuditSnapshot = z.infer<typeof runtimeAuditSnapshotSchema>;
export type SharedCacheManifest = z.infer<typeof sharedCacheManifestSchema>;
