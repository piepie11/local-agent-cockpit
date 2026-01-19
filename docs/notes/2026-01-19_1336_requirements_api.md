# requirementsPath API

做了什么
- POST/PATCH workspaces 支持 requirementsPath（相对/绝对路径 resolve），并统一校验 plan/convention/requirements 必须在 rootPath 内。
- 新增 GET /api/workspaces/:id/requirements 读取 requirements 文档（含 requirementsPath + truncated）。
- 读取失败返回 FILE_NOT_FOUND 或 REQUIREMENTS_READ_FAILED 并带 requirementsPath。

怎么验证
- npm test

结果
- npm test: pass

下一步
- 等待下一步指令
