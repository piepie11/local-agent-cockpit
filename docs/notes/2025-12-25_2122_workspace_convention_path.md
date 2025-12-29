# Workspace 支持自定义约定文件路径（conventionPath）

## 需求

希望“约定文件”像 `planPath` 一样可配置：不同 workspace 可以用不同文件名/路径，而不是固定只认 `约定.md`。

## 实现

- workspace 增加字段 `conventionPath`（默认：`<workspaceRoot>/约定.md`）
  - DB：`workspaces.conventionPath`（启动时做迁移：旧库自动 `ALTER TABLE` + 回填默认路径）
  - API：`POST /api/workspaces`、`PATCH /api/workspaces/:id` 支持 `conventionPath`
  - UI：设置页“添加工作区”新增 `conventionPath` 输入；控制台工作区信息增加显示
- 路径解析与默认：
  - `planPath` / `conventionPath` 都支持：
    - 绝对路径：按原样使用
    - 相对路径：相对 `rootPath` 解析
    - 留空：使用默认文件名（`plan.md` / `约定.md`）
- Orchestrator 注入约定的策略：
  - 优先读取 `workspace.conventionPath`
  - 若找不到该文件：回退到 `docs/templates/workspace_约定.md`（并在注入的约定文本里写明“workspace 文件缺失 + 已使用默认模板”，避免静默回退）

## 验证

- `npm run m2:api:e2e` → PASS
- `npm run m1:e2e:fake` → PASS

