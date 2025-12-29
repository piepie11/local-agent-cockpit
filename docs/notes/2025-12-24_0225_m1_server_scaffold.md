# 2025-12-24_0225 — M1：Server/DB 脚手架（workspaces/sessions/runs + SSE）

## 做了什么
- 新增 Node/Express 服务端骨架：`src/server.js`
- 新增 SQLite（`node:sqlite`）持久化：`src/storage/*`（workspaces/sessions/runs/turns/events/artifacts）
- 新增基础安全约束：
  - `ADMIN_TOKEN`：所有写接口必须带 token（header/query）
  - `ALLOWED_WORKSPACE_ROOTS`：workspace 根目录白名单
- 新增 SSE：`GET /api/runs/:id/events`，支持断线重连按 `seq` 续拉（基于 events 表）
- 新增最小 Web 占位页：`web/`（仅展示 health/workspaces，后续扩展为 Dashboard/History）
- `package.json`：引入 `express` + `dev/start` 脚本

## 如何验证
1) 安装依赖：`npm install`
2) 代码自检：`node -e "const { createServer } = require('./src/server'); const { store } = createServer(); store.close(); console.log('createServer: OK');"`
3) 启动服务（人工验证）：`npm run dev`，浏览器打开 `http://127.0.0.1:8787/`

## 结果
- `createServer()` 可正常初始化 DB 并退出
- `/api/health` 与 `/api/workspaces` 可访问

## 下一步
- M1：补齐 Run 控制面（start/stop/pause/step/inject/export）与 Orchestrator（Manager↔Executor 自动回合）

