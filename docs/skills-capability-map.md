# Skills Capability Map

这份文档只解决一件事: 把仓库里的 `skills` 按职责拆清楚，方便选择、组合和治理，避免把“分发副本”当成“功能重复”。

## 目标

- 明确每个 skill 的主职责
- 明确哪些 skill 可以组合使用
- 明确哪些 skill 不应该互相替代
- 明确仓库里哪些目录是源头，哪些只是产物

## 先看清楚哪些才是源头

技能相关内容分成 4 层:

1. **Canonical source**
   - `assets/skills/**/SKILL.md`
   - 这里才是 skill 的真实说明和工作流定义
2. **Capability metadata**
   - `registry/capabilities/skill/**/*.yaml`
   - 这里定义 skill 的治理记录、安装方式、绑定策略
3. **Runtime activation**
   - `runtimes/*.yaml`
   - 这里定义哪些 runtime 会启用哪些 capability
4. **Derived / packaged output**
   - `assets/plugins/*/targets/*`
   - `generated/**`
   - 这些是打包副本或渲染结果，不是职责定义源头

一句话原则:

- 看职责: 去 `assets/skills`
- 看治理: 去 `registry/capabilities/skill`
- 看谁在用: 去 `runtimes/*.yaml`
- 不要把 `assets/plugins/*/targets/*` 当作第二套 skill source of truth

## 当前库存和启用现状

按 `generated/shared-cache/manifests/shared-cache-manifest.json`，当前共享 skill 库里有 **22 个 skills**。

当前 runtime 启用情况:

| Runtime | 当前启用方式 | 说明 |
| --- | --- | --- |
| `codex` | 13 个直连 skills + `plugin.figma` + `mcp.figma` | Figma 能力主要通过插件进入，而不是直接出现在 `desired-state.skills` |
| `claude` | `plugin.ui-ux-pro-max` | 目前没有单独启用 governed skills |
| `cursor` | 无 governed skills | 目前只启用 MCP |

这意味着:

- 仓库里虽然有完整的 Figma skills，但在 Codex 侧它们更多是由 `plugin.figma` 暴露出来
- `assets/plugins/figma/targets/codex/skills/*` 与 `assets/skills/figma/*` 是同一能力链路的不同层，不应该算重复设计

## 职责地图

### 1. Figma 设计链路

| Skill | 主职责 | 主要产物 | 正确搭配 | 不要拿它做什么 |
| --- | --- | --- | --- | --- |
| `figma-use` | Figma Plugin API 的低层读写与脚本执行规范 | 对 Figma 节点、变量、组件、页面的精确修改 | `figma-generate-design`、`figma-generate-library` | 不负责决定产品级工作流，不适合作为“我要做一个页面”的唯一入口 |
| `figma-generate-design` | 从代码或描述在 Figma 里构建/更新整页 screen，优先复用设计系统 | Figma screen / page | **必须**配合 `figma-use` | 不负责生成仓库代码，不负责 Code Connect |
| `figma-generate-library` | 在 Figma 中建立/更新设计系统、tokens、组件库、主题 | Figma design system | **必须**配合 `figma-use` | 不适合只做单个页面，不适合仓库代码实现 |
| `figma-implement-design` | 把 Figma 设计实现成仓库里的产品代码 | Repo code | 可配合 `create-design-system-rules` | 不负责写回 Figma 画布 |
| `figma-code-connect-components` | 把 Figma 已发布组件映射到代码组件 | Code Connect mappings | 可配合 `figma-implement-design` | 不负责画布编辑，不负责整页搭建 |
| `figma-create-design-system-rules` | 为项目生成 Figma-to-code 规则文件 | `AGENTS.md` / `CLAUDE.md` / Cursor rules | 可作为 Figma 工作流前置治理 | 不负责交付具体页面或代码 |
| `figma-create-new-file` | 创建新的空白 Figma / FigJam 文件 | 新文件 URL + file key | 后续配合 `figma-use` | 不负责更新已有文件 |

### 2. 工程质量与测试

| Skill | 主职责 | 主要产物 | 正确搭配 | 不要拿它做什么 |
| --- | --- | --- | --- | --- |
| `testing-quality` | 测试策略、根因定位、回归验证、提交流水线质量门禁 | 修复方案、测试补齐、质量门禁结果 | `playwright-cli`、`playwright-best-practices` | 不要让它变成“只会写 Playwright”的窄技能 |
| `playwright-cli` | 直接驱动浏览器做复现、抓状态、交互验证 | 浏览器操作、快照、截图、临时验证 | `testing-quality` | 不负责测试架构和最佳实践设计 |
| `playwright-best-practices` | Playwright 测试设计、模式、稳定性和架构建议 | 测试结构与实现建议 | `testing-quality` | 不适合做手工复现或临时 UI 操作 |
| `receiving-code-review` | 收到 review 意见后先核实、再实施、必要时推回 | 经验证的 review 处理动作 | `testing-quality` | 不负责主动发起审查 |
| `requesting-code-review` | 在任务完成后发起审查，提早拦截问题 | review 请求流程 | 放在开发收尾阶段 | 不负责判断 review 意见是否正确 |

### 3. 专项编码能力

| Skill | 主职责 | 主要产物 | 正确搭配 | 不要拿它做什么 |
| --- | --- | --- | --- | --- |
| `prisma-performance` | Prisma schema、查询、索引、连接池和慢查询优化 | 可直接替换的 Prisma 优化代码 | `testing-quality` | 不负责通用数据库建模之外的产品规划 |
| `typescript-advanced-types` | TypeScript 高级类型建模与推断 | 类型设计与实现建议 | 与具体业务实现技能配合 | 不适合作为通用 TypeScript 开发总入口 |
| `tailwindcss-advanced-layouts` | Tailwind 高级布局模式与片段参考 | Grid/Flex/Container Query 布局写法 | `ui-ux-pro-max` | 不负责视觉方向、品牌表达或 UX 审核 |

### 4. 设计与产品

| Skill | 主职责 | 主要产物 | 正确搭配 | 不要拿它做什么 |
| --- | --- | --- | --- | --- |
| `ui-ux-pro-max` | UI 结构、视觉风格、交互体验、可用性改进 | 设计方向、界面改进建议、UI 实现策略 | `tailwindcss-advanced-layouts`、`testing-quality` | 不应替代标准化审计工具 |
| `web-design-guidelines` | 基于外部最新 Web Interface Guidelines 做审计 | 审计 findings | 适合 review / audit 场景 | 不负责产出新的设计方向或创意方案 |
| `product-manager-toolkit` | 优先级、访谈分析、PRD、发现式产品流程 | PM 文档、优先级结果、访谈洞察 | 与实现类技能解耦使用 | 不负责具体代码实现 |

### 5. 元技能

| Skill | 主职责 | 主要产物 | 正确搭配 | 不要拿它做什么 |
| --- | --- | --- | --- | --- |
| `skill-creator` | 创建、改造、评测和优化 skill | 新 skill、评测结果、触发优化 | 可配合 `requesting-code-review` | 不负责业务功能实现 |
| `writing-plans` | 在动手编码前生成多步骤实现计划 | `docs/plans/*.md` | 适合大型任务前置 | 不负责直接写业务代码 |

## 重叠处理规则

### `testing-quality`、`playwright-cli`、`playwright-best-practices`

- `testing-quality` 是总入口
- `playwright-cli` 只负责“操作浏览器复现/观察”
- `playwright-best-practices` 只负责“测试架构和写法”

推荐分工:

- 先用 `testing-quality` 定义调试和验证流程
- 如果需要浏览器复现，用 `playwright-cli`
- 如果要改 Playwright 测试结构、POM、flaky 方案，再用 `playwright-best-practices`

### `ui-ux-pro-max` 和 `web-design-guidelines`

- `ui-ux-pro-max` 负责“怎么变更 UI 才更好”
- `web-design-guidelines` 负责“现有 UI 是否违反规范”

推荐分工:

- 需要创意、结构、风格、体验改进时，用 `ui-ux-pro-max`
- 需要审计和 checklist finding 时，用 `web-design-guidelines`

### `ui-ux-pro-max` 和 `tailwindcss-advanced-layouts`

- `ui-ux-pro-max` 决定布局意图和体验目标
- `tailwindcss-advanced-layouts` 提供 Tailwind 级别的具体布局写法

### Figma 技能之间的边界

- 改 Figma 画布或变量: `figma-use`
- 在 Figma 中搭整页 screen: `figma-generate-design` + `figma-use`
- 在 Figma 中做设计系统: `figma-generate-library` + `figma-use`
- 从 Figma 生成仓库代码: `figma-implement-design`
- 给组件做 Code Connect: `figma-code-connect-components`
- 生成项目规则: `figma-create-design-system-rules`
- 先新建文件: `figma-create-new-file`

判断原则只有一条:

- **看最终交付物**
  - 交付物是 Figma 页面: `generate-design`
  - 交付物是 Figma 设计系统: `generate-library`
  - 交付物是代码: `implement-design`
  - 交付物是映射关系: `code-connect-components`

### `skill-creator`、`writing-plans`、`product-manager-toolkit`

- `skill-creator` 面向“技能资产本身”
- `writing-plans` 面向“工程实现计划”
- `product-manager-toolkit` 面向“产品决策与文档”

三者不要互相替代。

## 推荐使用路径

### 场景 1: 想把页面同步到 Figma

1. 没有文件先用 `figma-create-new-file`
2. 做 screen 用 `figma-generate-design`
3. 所有 `use_figma` 调用都遵守 `figma-use`
4. 如果后续还要把组件和代码连起来，再用 `figma-code-connect-components`

### 场景 2: 想从 Figma 落代码

1. 用 `figma-implement-design`
2. 如果项目还没有统一规则，先补 `figma-create-design-system-rules`
3. 代码改完后走 `testing-quality`

### 场景 3: UI 看起来不够好

1. 用 `ui-ux-pro-max` 定方向
2. 如果是 Tailwind 布局细节，再引入 `tailwindcss-advanced-layouts`
3. 如果需要规范审计，用 `web-design-guidelines`
4. 代码收尾走 `testing-quality`

### 场景 4: Playwright 相关问题

1. 先用 `testing-quality` 确认是复现问题、测试问题还是架构问题
2. 复现问题用 `playwright-cli`
3. 测试设计和 flaky 改造用 `playwright-best-practices`

### 场景 5: 要创建或治理 skill

1. 用 `skill-creator`
2. 如果是大规模改造，额外用 `writing-plans`

## 目前最值得优化的地方

以下不是功能错误，而是职责治理上的建议:

1. `tailwindcss-advanced-layouts` 和 `typescript-advanced-types` 目前更像“参考资料型 skill”
   - 它们缺少像其他 skills 那样清晰的 frontmatter 触发语义与边界说明
   - 如果要继续保留为 first-class skill，建议补 `name`、`description`、`when to use`、`when not to use`

2. `testing-quality` 应明确作为测试/调试总入口
   - Playwright 相关能力尽量作为它的二级专长，不要并列抢入口

3. `web-design-guidelines` 应只用于 audit
   - 它依赖外部最新 guidelines，更适合“审查”而不是“创作”

4. Figma 能力建议继续坚持“按交付物分工”
   - 页面、设计系统、代码、映射、规则，五类结果不要混写在一个 skill 里

## 简化后的记忆法

- **做 Figma 画布**: `figma-use`
- **做 Figma 页面**: `figma-generate-design`
- **做 Figma 设计系统**: `figma-generate-library`
- **做 Figma 到代码**: `figma-implement-design`
- **做 Figma 到代码映射**: `figma-code-connect-components`
- **做 UI 方向和体验**: `ui-ux-pro-max`
- **做 UI 审计**: `web-design-guidelines`
- **做测试/调试/质量**: `testing-quality`
- **做浏览器复现**: `playwright-cli`
- **做 Playwright 设计方法**: `playwright-best-practices`
- **做 PM 工作**: `product-manager-toolkit`
- **做 skill 本身**: `skill-creator`
- **做实现计划**: `writing-plans`
