# M5a ask rename to Codex User Window

做了什么
- 将 UI 中所有“随口问”文案改为“Codex 用户窗口”，英文统一为“User Window”。
- 更新相关文档/提示文案（如 PROJECT_REPORT 与 ask_system prompt）。

怎么验证
- npm test
- npm run m4:ask:e2e

结果
- npm test：通过
- npm run m4:ask:e2e：通过（SQLite experimental warning）

下一步
- 进入 M5 的状态/耗时/用量与恢复最小化。
