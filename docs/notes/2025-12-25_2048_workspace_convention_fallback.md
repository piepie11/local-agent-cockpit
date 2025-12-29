# 2025-12-25 20:48 — Workspace `约定.md` 支持 + 通用默认公约回退

## 目标
- 支持“每个 workspace/项目可以有自己的工程公约 `约定.md`”。
- 若项目没有提供 `约定.md`，则使用 `auto_codex` 内置的通用默认公约，保证 Manager/Executor 至少有一套可执行的工程化底线。

## 约定文件策略
- workspace 优先：`<workspaceRoot>/约定.md`
- 缺省回退：`docs/templates/workspace_约定.md`

> 不会自动写入/改动 workspace 的文件；只是把公约内容注入到提示词里作为“规则上下文”。

## 变更
- 新增通用默认公约模板：`docs/templates/workspace_约定.md`
- 编排器读取并注入公约：
  - `src/orchestrator/orchestrator.js`：新增 `readWorkspaceConvention()`（workspace 优先，缺省回退）
  - `src/orchestrator/prompt_builder.js`：在 Manager 全量 prompt 与 Executor resume seed prompt 中加入 `<CONVENTION>` 块，并附带 `CONVENTION_SOURCE/CONVENTION_PATH`

## 验证
- `npm run m2:api:e2e`（PASS）

## 使用说明
- 若你的目标项目需要更严格/更专业的规范：在项目根目录创建 `约定.md`（可从 `docs/templates/workspace_约定.md` 复制并按项目裁剪/补充）。
- 若项目没有 `约定.md`：会自动使用默认公约（注入 prompt，不写入项目目录）。

