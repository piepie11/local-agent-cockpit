# 2025-12-28 21:05 — `plan.md` 补充：Dashboard 就地编辑会话配置

## 背景

- 当前“会话配置（Sessions）”的编辑需要切换到 Sessions 页面，用户会觉得多一步且不必要。
- 典型使用路径在 Dashboard/控制台内完成（选 workspace → 选/建 sessions → Start/Step），因此会话配置也应就地可改。

## 计划调整

- 在 `plan.md` 的 M3（workspace 可编辑）中增加一项任务：
  - 在 Dashboard/控制台的 Sessions 列表里，为每个会话条目提供“编辑/重置/复制”等动作入口；
  - 编辑 UI 复用现有“编辑会话”表单，但用 modal（桌面）/bottom sheet（移动端）弹出，不强制页面跳转；
  - 保存/重置必须校验 `ADMIN_TOKEN`，并在成功后立即刷新 sessions 列表，确保下一次 Run 使用更新后的配置。

## 验证

- 文档一致性检查：确认 `plan.md` 的 M3 中包含 “Sessions 配置就地编辑” 的任务、验收与手测项。

