# Skills Capability Map

这份文档只解决一件事：把仓库里的 skills、plugins、MCP 按职责拆清楚，方便选型、组合和治理。

## Source Of Truth

1. `assets/skills/**/SKILL.md`
   这里是 skill 的原始说明和工作流。
2. `assets/plugins/*/targets/*`
   这里是面向具体 runtime 的插件打包产物。
3. `registry/capabilities/**/*.yaml`
   这里定义 capability 的治理元数据、安装方式、风险级别和运行时绑定。
4. `runtimes/*.yaml`
   这里决定每个 runtime 实际启用哪些 capability。

一句话记忆：

- 看 skill 内容，去 `assets/skills`
- 看 plugin 包装，去 `assets/plugins`
- 看治理记录，去 `registry/capabilities`
- 看谁在启用，去 `runtimes`

## Coding Capabilities

当前编码与交付相关能力分成七层：

| 能力 | 角色 | 当前状态 |
| --- | --- | --- |
| `skill.brainstorming` | 需求澄清、方案分岔、spec-first 设计 | 已启用在 `codex` |
| `skill.writing-plans` | 把确认过的设计转成可执行 implementation plan | 已启用在 `codex` |
| `skill.systematic-debugging` | root-cause-first 调试与故障定位 | 已启用在 `codex` |
| `skill.requesting-code-review` | 主动请求 review 的质量闸门 | 已启用在 `codex` |
| `skill.receiving-code-review` | 消化 review、识别该改与不该盲改的地方 | 已启用在 `codex` |
| `skill.testing-quality` | 测试补齐、验证、提交前质量收口 | 已启用在 `codex` |
| `skill.writing-skills` | skill 的编写、评测与迭代 | 已启用在 `codex` |

编码侧的主张也很明确：

- `brainstorming` 负责把需求讲清楚，不直接跳实现。
- `writing-plans` 负责把已确认方向拆成执行步骤。
- `systematic-debugging` 负责先找根因，再动修复。
- `requesting-code-review` 和 `receiving-code-review` 负责 review 前后闭环。
- `testing-quality` 负责验证，不替代设计或 review。
- `writing-skills` 只用于维护 skill 本身，不是日常 feature 开发主入口。

## Coding Runtime View

| Runtime | 当前编码相关启用方式 | 说明 |
| --- | --- | --- |
| `codex` | `brainstorming` + `writing-plans` + `systematic-debugging` + `requesting-code-review` + `receiving-code-review` + `testing-quality` + `writing-skills` | 当前主编码编排 runtime |
| `claude` | 无受治理 coding workflow skill | 当前主要保留插件与原生配置治理 |
| `cursor` | 无受治理 coding workflow skill | 当前主要保留 MCP 与 user skills 同步能力 |

## Design Capabilities

当前设计相关能力分成三层：

| 能力 | 角色 | 当前状态 |
| --- | --- | --- |
| `skill.impeccable.*` | 设计语言、审美打磨、界面精修 | 已启用在 `codex` |
| `plugin.impeccable` | Claude 侧的 Impeccable 插件封装 | 已启用在 `claude` |
| `skill.web-design-guidelines` | 基于外部 Web Interface Guidelines 做审计 | 已启用 |

设计侧的主张现在很明确：

- `Impeccable` 负责设计感、排版、层级、polish、critique。
- `web-design-guidelines` 负责审计、checklist、finding。
- `ui-ux-pro-max` 已停用，不再作为主设计入口。

## Design Runtime View

| Runtime | 当前设计相关启用方式 | 说明 |
| --- | --- | --- |
| `codex` | `skill.impeccable.*` + `skill.web-design-guidelines` | Codex 直接消费 Impeccable 技能目录 |
| `claude` | `plugin.impeccable` | Claude 通过 marketplace/plugin 形式消费 Impeccable |
| `cursor` | 无受治理设计 skill | 当前只保留受治理 MCP |

## Design Responsibilities

### Impeccable

适合：

- 已有页面不够高级，想继续提设计感
- 需要 `/audit`、`/critique`、`/polish`、`/typeset`
- 需要统一视觉语言、信息层级和界面气质

不适合：

- 充当规范审计器
- 替代 Figma 设计链路

### web-design-guidelines

适合：

- review 前后的规范审计
- 基于最新 guideline 输出 findings
- 检查现有 UI 是否存在明显规范偏差

不适合：

- 决定品牌气质和视觉方向
- 承担创意型设计生成

### tailwindcss-advanced-layouts

适合：

- Tailwind 层面的 Grid、Flex、Container Query 布局实现

不适合：

- 代替设计方向判断
- 代替 UX 审计

## Coding Responsibilities

### brainstorming

适合：

- 新功能、较大改动、需求还不清楚
- 需要先明确接口、数据流、边界和 success criteria
- 需要先出 spec，再进入实现

不适合：

- 已经明确根因的单点修复
- 纯机械修改或无决策空间的小变更

### systematic-debugging

适合：

- flaky test、CI 故障、生产 bug、构建异常
- 已经出现回归，但根因还不清楚
- 多组件链路里需要逐层定位断点

不适合：

- 凭直觉直接打补丁
- 用 symptom fix 代替根因修复

### requesting-code-review

适合：

- 重要任务收尾
- 阶段性实现完成，需要质量闸门
- 修复复杂问题后，需要再做一次独立复核

不适合：

- 代替测试
- 代替需求澄清或技术设计

### receiving-code-review

适合：

- 收到 review 后判断哪些该改、哪些要 challenge
- 避免表面顺从、技术上却把问题越改越偏

不适合：

- 在没有理解反馈的情况下机械照改

### writing-skills

适合：

- 新建 skill
- 修改现有 skill 的触发条件、流程或 supporting files
- 为 skill 设计压力测试和评估闭环

不适合：

- 普通业务开发
- 把项目级约定误写成通用 skill

## Figma Responsibilities

| Skill | 主职责 | 结果物 |
| --- | --- | --- |
| `figma-use` | Figma 低层读写与操作 | 对节点、变量、组件、页面的精确修改 |
| `figma-generate-design` | 生成或更新页面设计 | Figma 页面或 screen |
| `figma-generate-library` | 生成或更新设计系统 | Figma library / tokens / components |
| `figma-implement-design` | 从 Figma 落代码 | Repo code |
| `figma-code-connect-components` | 做 Code Connect 映射 | 组件映射关系 |
| `figma-create-design-system-rules` | 生成设计系统规则文件 | 项目规则文档 |
| `figma-create-new-file` | 新建 Figma / FigJam 文件 | 新文件和 file key |

判断原则只有一条：看最终交付物是什么。

- 要改 Figma 画布，用 `figma-use`
- 要做 Figma 页面，用 `figma-generate-design`
- 要做 Figma 设计系统，用 `figma-generate-library`
- 要把 Figma 落到代码，用 `figma-implement-design`

## Coding Orchestration

### 场景 1：新功能或需求还不清晰

1. 先用 `brainstorming` 澄清目标、约束、方案分歧，并沉淀 spec。
2. spec 确认后转 `writing-plans`，把设计拆成 implementation plan。
3. 实施过程中到达阶段性节点，用 `requesting-code-review` 做质量闸门。
4. 最后用 `testing-quality` 做验证收口。

### 场景 2：遇到 bug、flaky test 或 CI 异常

1. 先用 `systematic-debugging` 做 root cause investigation。
2. 根因明确后再实施修复，不要倒过来。
3. 如果改动较大或风险较高，补一次 `requesting-code-review`。
4. 收尾走 `testing-quality`。

### 场景 3：收到 review feedback

1. 先用 `receiving-code-review` 判断反馈是否成立，以及应该怎么改。
2. 实施修改。
3. 如改动影响边界、行为或架构，再用 `requesting-code-review` 复核一次。
4. 最后走 `testing-quality`。

### 场景 4：维护 skill 本身

1. 用 `writing-skills` 设计 skill 结构、pressure scenario 和验证方法。
2. 如果 skill 是调试类或故障分析类，可结合 `systematic-debugging` 观察 baseline failure。
3. 最终仍然回到仓库治理主链路：`review -> approve -> publish -> render -> sync`。

## Design Orchestration

### 场景 1：现有 UI 不够好看

1. 先用 `Impeccable` 明确设计方向并做 polish / critique。
2. 如果问题落在 Tailwind 布局实现，再用 `tailwindcss-advanced-layouts`。
3. 收尾时用 `web-design-guidelines` 做审计。
4. 代码验证走 `testing-quality`。

### 场景 2：需要做规范审计

1. 用 `web-design-guidelines` 拉出 findings。
2. 如果需要把页面再抬一档，再回到 `Impeccable` 做 refinement。

### 场景 3：从 Figma 落地到代码

1. 用 `figma-implement-design` 生成或更新代码。
2. 如果项目规则不清晰，先用 `figma-create-design-system-rules`。
3. 代码收尾走 `testing-quality`。

### 场景 4：要在 Figma 里搭页面或设计系统

1. 没有文件先用 `figma-create-new-file`。
2. 做页面用 `figma-generate-design`。
3. 做 library 用 `figma-generate-library`。
4. 所有精确编辑都遵循 `figma-use`。

## Deprecations

`ui-ux-pro-max` 现在只保留历史 capability 记录，不再启用，不再推荐，也不再作为设计主入口。

## Quick Memory

- 做需求澄清和 spec：`brainstorming`
- 做计划拆解：`writing-plans`
- 做根因调试：`systematic-debugging`
- 做 review 请求：`requesting-code-review`
- 做 review 反馈处理：`receiving-code-review`
- 做测试与质量收口：`testing-quality`
- 做 skill 维护：`writing-skills`
- 做设计打磨：`Impeccable`
- 做规范审计：`web-design-guidelines`
- 做 Tailwind 布局实现：`tailwindcss-advanced-layouts`
- 做 Figma 页面：`figma-generate-design`
- 做 Figma 设计系统：`figma-generate-library`
- 做 Figma 到代码：`figma-implement-design`
