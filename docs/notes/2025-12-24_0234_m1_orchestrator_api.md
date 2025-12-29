# 2025-12-24_0234 — M1：Orchestrator + Run 控制 API（start/pause/step/stop/inject/export）

## 做了什么
- 新增 Orchestrator：`src/orchestrator/orchestrator.js`
  - 自动回合：Manager -> Executor（Manager 输出 `Done` 则结束）
  - 每轮落盘：`runs/<workspaceId>/<runId>/turn-XXX/{manager|executor}/...`
  - 事件入库 + SSE 广播：`events` 表，支持断线按 `seq` 续拉
  - per-turn 超时（默认 10 分钟，可在 run.optionsJson 覆盖）
  - 最小格式校验：Manager 必须包含 `<MANAGER_PACKET>`，Executor 必须包含 `<EXEC_LOG>`（否则自动 PAUSE）
- 新增 Codex provider（支持 abort/kill）：`src/providers/codex_exec.js`
- 新增 repoDigest（tree/git status/diff stat）：`src/repo_digest.js`
- 新增导出：`GET /api/runs/:id/export?format=md|json|jsonl`（同时落盘到 runs 并写入 artifacts 表）
- 服务端新增写接口（均需 `ADMIN_TOKEN`）：
  - `POST /api/runs/:id/start`
  - `POST /api/runs/:id/pause`
  - `POST /api/runs/:id/step`
  - `POST /api/runs/:id/stop`
  - `POST /api/runs/:id/inject`

## 如何验证
- `node -e "const { createServer } = require('./src/server'); const { store } = createServer(); store.close(); console.log('load OK');"`
- `npm run m0:smoke`（确保既有 codex exec 封装未被破坏）

## 结果
- server 可正常加载
- smoke test 通过（Codex 可用，落盘 OK）

## 下一步
- Web UI：做成真正可用的 Dashboard（workspace/session/run 管理 + 流式输出 + 控制按钮 + History/Export）

