# 2025-12-29 00:58 — Sessions：编辑会话时可配置 sandbox 权限

## 背景

- “会话（Sessions）”已有创建时的 `sandbox` 选择，但编辑会话时无法调整权限。
- 这会导致用户想临时把 Executor 从 `read-only` 切到 `workspace-write` 时必须删掉重建，体验不佳。

## 改动

- `web/index.html`
  - 在“编辑会话”表单新增 `editSessionSandbox` 下拉框（read-only / workspace-write / danger-full-access）
- `web/app.js`
  - `fillEditSessionForm()`：回填当前会话 `cfg.sandbox`
  - `saveEditedSession()`：将选择写回 session `configJson`（通过 `PATCH /api/sessions/:id`）

## 验证

- 手动：
  - 进入 Sessions 页面，选择某个 session
  - 修改 sandbox 并保存，刷新后应能在 Session info 中看到权限变更

