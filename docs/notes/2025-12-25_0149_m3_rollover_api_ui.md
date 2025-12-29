# 留痕：Rollover（会话换血）API/UI + 存储链路 + e2e

## 做了什么
- 存储：
  - `src/storage/schema.js` 新增 `session_rollovers` 表（记录 from→to、role/provider、runId、summaryPath）
  - `src/storage/store.js` 新增：
    - `createSessionRollover()` / `listSessionRollovers()`
    - `updateRunSessions()`（在 run 内切换 manager/executor session）
- API（`src/server.js`）：
  - `POST /api/sessions/:id/rollover`（需 `ADMIN_TOKEN`）：
    - 复制旧 session 配置创建新 session（providerSessionId=null）
    - 生成 rollover summary markdown 并写入 `runs/<workspaceId>/<runId>/rollover/...md`
    - 将 `rolloverSummaryPath` 写回新 session 的 `configJson`
    - 如传入 `runId` 且 run 正在使用旧 session，则自动把 run 的 sessionId 切到新 session
    - 写入 SSE meta 事件：`{type:'rollover', fromSessionId, toSessionId, summaryPath}`
  - `GET /api/workspaces/:id/rollovers`：列出该 workspace 的 rollover 记录
- Orchestrator（`src/orchestrator/orchestrator.js`）：
  - seed 轮支持读取 `rolloverSummaryPath/rolloverSummary`，用 summary 代替 plan 注入（作为新会话种子）
  - rollover seed 轮 repoDigest 默认走 delta（不含 tree），避免上下文爆炸
- UI（`web/index.html` + `web/app.js`）：
  - Dashboard 增加 Rollover（manager/executor）按钮 + reason 输入
  - Sessions 页面增加 Rollovers 列表 + Refresh
- e2e：
  - `scripts/m3_rollover_e2e.js` + `npm run m3:e2e:rollover`（fake provider，验证 API 闭环 + run session swap + rollovers list）

## 怎么验证
- `npm run m3:e2e:rollover`（PASS）

## 结果
- 支持手动触发 rollover，并可在 UI/History（rollovers 列表）追溯 old→new 会话链路；run 可在下一轮自动切换到新 session。

## 下一步
- 做全量回归（`npm run m2:deep` + 新增 m3 脚本），并把 `约定.md` 的里程碑进度更新到 DONE。

