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

## Current Design Setup

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

## Runtime View

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

## Recommended Flows

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

- 做设计打磨：`Impeccable`
- 做规范审计：`web-design-guidelines`
- 做 Tailwind 布局实现：`tailwindcss-advanced-layouts`
- 做 Figma 页面：`figma-generate-design`
- 做 Figma 设计系统：`figma-generate-library`
- 做 Figma 到代码：`figma-implement-design`
- 做测试与质量收口：`testing-quality`
