# Skills Capability Map

这份文档定义产品研发流程中的 skill 分工。真实启用状态以 `profiles/*.yaml`、`runtimes/*.yaml`、`machines/*.yaml` 和 runtime audit 为准。

## Source Of Truth

- `assets/skills/**/SKILL.md`: skill 内容。
- `registry/capabilities/**/*.yaml`: 来源、风险、生命周期、activation 元数据。
- `profiles/*.yaml`: 哪些能力在某类项目中启用、引用或阻断。
- `runtimes/*.yaml`: runtime 适配和最小基础能力。
- `machines/*.yaml`: 当前机器启用哪些 profiles。
- `generated/machines/**/desired-state.json`: render 后的期望 runtime 状态。
- `generated/machines/**/project-scopes.json`: 项目作用域能力及其项目本地配置目标。

## Product Development Phases

| Phase | Skill | Trigger |
| --- | --- | --- |
| Design | `skill.impeccable.frontend-design`, `skill.impeccable.clarify` | 前端界面创建或 UX 文案改进 |
| Implementation | `skill.next-best-practices` | Next.js 项目专用实现或审查 |
| E2E | `skill.playwright-best-practices` | Playwright 测试设计、flaky、auth、fixture、POM |
| Governance | `skill.agent-governance`, `skill.skill-audit` | 全局能力采用、覆盖、触发治理和废弃审计 |
| Tool | `skill.prompt-master` | prompt、prompt template、system instruction、skill prompt、trigger/anti-trigger 设计或审查 |
| Web QA | `skill.mercaso-admin-readonly-browser-test` | Mercaso Admin Web SAT/PROD 只读浏览器 smoke test |

## Active Profiles

| Profile | Role |
| --- | --- |
| `codex-base` | Codex 基础工具与高风险插件禁用 |
| `helix-product` | Helix 产品研发，项目 `AGENTS.md` 优先 |
| `mercaso-web` | Mercaso Web 维护与 review |
| `mercaso-harness` | Mercaso Playwright harness，项目 rulebook 优先 |
| `mercaso-admin-readonly` | 仅在 Mercaso Admin Web 暴露凭据型只读 smoke workflow |
| `agent-governance` | 本仓库 schema、profile、sync、audit、eval 治理 |
| `prompt-atelier` | 图像 prompt 生产 loop，依赖项目本地规则 |
| `nihongo-content` | 内容项目，依赖 Codex 原生任务处理与项目规则 |

## Explicit Deprecations

这些能力保留 registry 和资产历史，但不再进入 active Codex profile 或运行时输出：

- `skill.testing-quality`
- `skill.brainstorming`
- `skill.writing-plans`
- `skill.systematic-debugging`
- `skill.requesting-code-review`
- `skill.receiving-code-review`
- `skill.intent-routing`
- `skill.brainstorming-lite`
- `skill.implementation-plan-lite`
- `skill.long-task-planning`
- `skill.systematic-debugging-lite`
- `skill.verification-before-completion-lite`
- `skill.receiving-code-review-lite`
- `skill.unit-test-design`
- `skill.risk-based-tdd`
- `skill.karpathy-guidelines`
- `skill.code-review`
- `skill.skill-creator`
- `skill.product-manager-toolkit`
- `skill.typescript-advanced-types`
- `skill.tailwindcss-advanced-layouts`
- `skill.prisma-performance`
- `skill.web-design-guidelines`
- `skill.impeccable.critique`
- `skill.impeccable.harden`
- `skill.impeccable.normalize`
- `skill.impeccable.polish`
- `skill.impeccable.typeset`

通用规划、调试、review、测试和验证依赖 Codex 原生行为；静态或低质量知识 skill 等待更窄、更及时、经验证的替代；UI resilience、design-system、typography 和 polish 检查已合并进 `frontend-design` 的 `production-qa.md`。

## Plugin Policy

- `plugin.policy.disable-build-web-apps` 是全局禁用策略，目标是让 Codex 配置显式 `enabled = false`。
- `plugin.policy.disable-figma` 是默认禁用策略；需要 Figma 时按任务启用具体能力。
- `plugin.policy.disable-superpowers` 是默认禁用策略；只有经过评测的显式严谨模式才能覆盖它。
- `plugin.openai-curated.circleci` 只在 Mercaso profiles 中启用并写入项目 `.codex/config.toml`，不进入全局配置。
- `plugin.figma` 保留为 canonical/source plugin，不进入默认 Codex profile。日常只把 `skill.figma.implement-design`、`skill.figma.use` 和 `mcp.figma` 作为 on-demand reference；`Code Connect`、`generate-library`、`create-design-system-rules` 这类低频 Figma workflow 只能 project-explicit 或 reference-only。
- `skill.prompt-master` 全局安装，但只处理 prompt 设计、审查、压缩和触发测试；不能接管普通领域任务或治理采纳决策。
- Impeccable 只保留 `frontend-design` 和 `clarify`。生产 QA 检查集中在 `frontend-design/reference/production-qa.md`。
- `webapp-testing` 当前是 candidate/reference-only，批准前不能全局同步。

## Runtime Checks

Use:

```bash
pnpm governance runtime-audit --runtime codex
pnpm governance trigger-eval
pnpm governance behavior-eval --dry-run
```

`runtime-audit` 对比 Codex 本地与远程插件、MCP、全局 user skills、项目精确信任、项目本地状态、plugin skill roots 和 rendered desired state。共享缓存位于 `~/.cache/agent-governance`；只有全局能力复制到 `~/.agents/skills`，项目能力通过 `.codex/config.toml` 的 `skills.config[].path` 引用缓存。`~/.codex/skills` 只保留 Codex 管理的 `.system`。
少量工具型或个人 capability 通过内建平台清单或 machine `runtimeAuditAllowlist` 显式允许；远程插件必须出现在同一 machine allowlist。CircleCI、Helix code-review graph 和 Mercaso readonly browser test 必须作为 project-scoped governed capabilities 出现在 `project-scopes.json`，不得出现在全局 desired state。

`trigger-eval` 是静态触发规则 lint：它能发现声明漂移，但不能证明真实模型行为。Skill/Plugin 采纳还必须使用代表性 live runs 或 Plugin Eval 做原生基线与候选能力对照。

`behavior-eval` 通过隔离的 `codex exec` 运行代表场景并记录 Skill 读取、工具调用、命令、文件变化和最终响应。写入场景只能在复制到临时目录的 fixture 中运行，并可约束允许修改的文件、验证命令和禁止的止血内容；`--dry-run` 只校验场景。Live run 依赖有效的 Codex CLI 登录状态。
