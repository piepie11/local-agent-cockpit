# 2025-12-24_0302 — History 详情/搜索 + 危险命令保护 + 文档/进度更新

## 做了什么
- History 页面增强：
  - 选中 run 后按轮次展示：manager/executor prompt preview + output（`web/app.js` + `web/index.html`）
  - turns search：按关键词过滤轮次内容
  - history 侧直接导出 md/json
- 后端 run 详情增强：
  - `GET /api/runs/:id` 返回每轮 prompt preview（读取 runs/ 落盘的 prompt.txt，截断 6k）
  - 同时返回 `managerMeta/executorMeta`（解析 metaJson）
- Orchestrator：危险命令保护（默认开启）
  - 从 Executor 的 `<EXEC_LOG>` 中解析 `COMMANDS`，命中黑名单则自动 PAUSE（error=`DANGEROUS_COMMAND`）
  - UI 创建 run 增加 `cmd guard` 开关
- 文档/公约：
  - 新增 `README.md`（启动、手机访问、安全配置、验证命令）
  - 更新 `约定.md` 当前里程碑进度到 M2

## 如何验证
- `npm run m1:e2e:fake` ✓
- `npm run m0:roundtrip` ✓
- `npm run m0:smoke` ✓

## 下一步
- 收尾：提交本次变更并做最终验收（对照 plan.md 的最终验收清单）

