# 留痕：capabilities 探测（Codex/Claude）+ API + UI + 可复现脚本

## 做了什么
- 新增能力探测模块：`src/capabilities.js`（探测 codex/claude 版本与关键 flags，输出 features）。
- 新增跨平台 spawn 适配：`src/lib/spawn_capture_smart.js`（Windows 优先使用 `cmd.exe` wrapper，避免 `.cmd/.ps1` 无法直接 spawn）。
- 新增存储：`src/storage/schema.js` 增加 `settings` 表，`src/storage/store.js` 增加 `getSetting/setSetting`。
- 新增 API：
  - `GET /api/capabilities`：读取缓存（DB / data/capabilities.json），未探测则返回 `NOT_PROBED`
  - `POST /api/capabilities/probe`（需 `ADMIN_TOKEN`）：执行探测并落库 + 落盘
- UI（Settings）新增 capabilities 面板：`web/index.html` + `web/app.js`
- 新增脚本：`scripts/m3_capabilities.js` + `npm run m3:capabilities`

## 怎么验证
- `npm run m3:capabilities`（生成 `runs/capabilities-*/capabilities.json`，并打印 codex/claude features）
- `node -e "const { createServer } = require('./src/server'); const { store } = createServer(); store.close(); console.log('createServer: OK');"`

## 结果
- capabilities 可在 UI 中查看；需要 refresh 时用 `ADMIN_TOKEN` 执行 Probe。
- 探测结果同时写入 DB（settings.key=capabilities）与 `data/capabilities.json`（gitignored）。

## 下一步
- 进入 M1：Session 增强（mode/model/providerSessionId）与 Codex thread_id 固化 + resume 多轮链路。

