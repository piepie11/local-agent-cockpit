# 允许在 UI 中编辑 ALLOWED_WORKSPACE_ROOTS（持久化 + 立即生效）

## 背景

过去 `ALLOWED_WORKSPACE_ROOTS` 只能通过环境变量/启动参数配置；对非开发用户不友好，且需要重启服务才能生效。

本次改动新增“运行时 allowlist（白名单）”能力：允许在 Settings 页面直接编辑允许的 workspace 根目录，并持久化到 SQLite（`settings` 表），保存后立即生效且重启后仍有效。

## 改动内容

- 后端新增 allowlist 运行时层：
  - 启动时：优先从 DB `settings.allowedWorkspaceRoots` 读取；不存在则回退到 env 的 `ALLOWED_WORKSPACE_ROOTS`。
  - `GET /api/health` 增加字段：`allowedWorkspaceRootsSource/allowedWorkspaceRootsUpdatedAt/allowedWorkspaceRootsError`。
  - `POST/PATCH /api/workspaces` 的 rootPath allowlist 校验改为使用运行时 allowlist（而不是固定的 config）。
- 后端新增写接口（需 `ADMIN_TOKEN`，且 `READ_ONLY_MODE=true` 会拒绝）：
  - `PUT /api/settings/allowedWorkspaceRoots`：保存 allowlist 到 DB 并立即生效。
  - `DELETE /api/settings/allowedWorkspaceRoots`：删除 DB 覆盖值，回退到 env allowlist。
- 前端 Settings 页面新增 allowlist 编辑器：
  - 支持从 health 填充、保存、恢复为环境变量，并显示来源/更新时间。

## 使用方式

1) 打开 Settings 页面
2) 在“允许的 rootPath（白名单）”文本框中每行填一个绝对路径
3) 点击“保存”
4) 新建/编辑 workspace 时会立刻使用新的 allowlist 校验

## 风险提示

allowlist 是重要安全边界：如果将其设置得过宽（例如 `C:\` 或 `/`），相当于允许注册任意目录作为 workspace，会显著放大风险面。建议仅添加必要的上层目录，并避免将服务暴露到公网。

## 验证

- `npm run m2:api:e2e`
  - 覆盖：设置接口鉴权、保存/重置 allowlist、allowlist 对 workspace 注册的影响、以及原有 API 回归。
- `npm test`

