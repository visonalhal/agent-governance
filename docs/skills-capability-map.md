# Skills Capability Map

这份文档定义产品研发流程中的 skill 分工。真实启用状态以 `profiles/*.yaml`、`runtimes/*.yaml`、`machines/*.yaml` 和 runtime audit 为准。

## Source Of Truth

- `assets/skills/**/SKILL.md`: skill 内容。
- `registry/capabilities/**/*.yaml`: 来源、风险、生命周期、activation 元数据。
- `profiles/*.yaml`: 哪些能力在某类项目中启用、引用或阻断。
- `runtimes/*.yaml`: runtime 适配和最小基础能力。
- `machines/*.yaml`: 当前机器启用哪些 profiles。
- `generated/machines/**/desired-state.json`: render 后的期望 runtime 状态。

## Product Development Phases

| Phase | Skill | Trigger |
| --- | --- | --- |
| Entry | `skill.intent-routing` | 任何治理项目任务先分类，不直接进 debugging 或计划 |
| Product | `skill.product-manager-toolkit`, `skill.brainstorming-lite` | 需求、用户价值、范围或取舍不清楚 |
| Planning | `skill.implementation-plan-lite` | 跨模块、迁移、runtime、共享契约改动 |
| Design | selected `skill.impeccable.*`, `skill.web-design-guidelines` | 明确 UI/设计审计或视觉 polish |
| Implementation | `skill.next-best-practices`, `skill.typescript-advanced-types`, `skill.prisma-performance` | 对应领域代码修改 |
| TDD | `skill.risk-based-tdd` | 高风险行为、回归、DB/auth/API/data transform |
| Unit Testing | `skill.unit-test-design` | 业务逻辑、parser、service、validator、generator 单测 |
| Web QA | `skill.webapp-testing` | 候选/reference-only；本地 Web UI QA，批准前不默认启用 |
| E2E | `skill.playwright-best-practices` | Playwright 测试设计、flaky、auth、fixture、POM |
| Debugging | `skill.systematic-debugging-lite` | 真实 bug、失败测试、CI、runtime exception、flaky |
| Review | `skill.code-review`, `skill.receiving-code-review-lite` | review findings 或 requested changes |
| Verification | `skill.verification-before-completion-lite` | 声称完成前报告实际验证 |
| Governance | `skill.skill-creator`, `skill.skill-audit` | 创建、评估、废弃、比较 skills/plugins/profiles |

## Active Profiles

| Profile | Role |
| --- | --- |
| `codex-base` | Codex 基础工具与高风险插件禁用 |
| `helix-product` | Helix 产品研发，项目 `AGENTS.md` 优先 |
| `mercaso-web` | Mercaso Web 维护与 review |
| `mercaso-harness` | Mercaso Playwright harness，项目 rulebook 优先 |
| `agent-governance` | 本仓库 schema、profile、sync、audit、eval 治理 |
| `prompt-atelier` | 图像 prompt 生产 loop 的轻量测试/验证 |
| `nihongo-content` | 内容项目的轻量产品/验证流程 |

## Explicit Deprecations

这些能力保留历史记录，但不再进入 active Codex profile 输出：

- `skill.testing-quality`
- `skill.brainstorming`
- `skill.writing-plans`
- `skill.systematic-debugging`
- `skill.requesting-code-review`
- `skill.receiving-code-review`

原因很简单：它们的触发范围太宽，容易把简单任务升级成流程任务。

## Plugin Policy

- `plugin.openai-curated.build-web-apps` 是 disable record，目标是让 Codex 配置显式 `enabled = false`。
- `plugin.openai-curated.superpowers` 是 disable record，目标是让 Codex 配置显式 `enabled = false`。
- Impeccable 只默认使用精选 skill：`frontend-design`、`critique`、`polish`、`harden`、`clarify`、`typeset`、`normalize`。
- `webapp-testing` 当前是 candidate/reference-only，批准前不能全局同步。

## Runtime Checks

Use:

```bash
pnpm governance runtime-audit --runtime codex
pnpm governance trigger-eval
```

`runtime-audit` 对比 Codex 实际插件、MCP、user skills、plugin skill roots 和 rendered desired state。
少量工具型 unmanaged capability 被显式允许，例如 Browser/Chrome/GitHub/Drive/Figma 插件、`node_repl`、Figma 本地辅助 skills 和 `hatch-pet`。

`trigger-eval` 固定检查两类关键错误：

- clone/config/meta 问题不能触发 debugging。
- flaky/failure 问题必须触发 debugging。
