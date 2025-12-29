# 留痕：plan.md 工程化补强（前置/范围/验收/落点）

## 做了什么
- 补齐 `plan.md` 的工程化信息：运行前置与关键配置（对应 `src/config.js`）、范围边界（in-scope / out-of-scope）。
- 增加“验收脚本与覆盖关系”一节，把新增能力（capabilities/resume/mixed/rollover）对应到未来要补的 npm scripts。
- 在 M1/M2/M3 里补“涉及模块（预计改动面）”，明确后续实现落点（Provider/Orchestrator/Storage/API/UI/Scripts）。
- 明确短期可把 `mode/model/streaming/schemaMode` 放 `sessions.configJson` 以避免立刻做 DB 迁移，稳定后再迁移到表字段（对应 plan 第 8 章）。

## 怎么验证
- 结构检查：`rg -n "^### 0\\.4|^### 10\\.4" plan.md` 确认新增章节存在。
- 可读性检查：`node -e "fs.readFileSync('plan.md','utf8')"` 可正常读出（无明显编码损坏）。

## 结果
- `plan.md` 可直接作为后续 M1/M2/M3 的可执行拆解与验收依据。

## 下一步
- 进入 M1：先做 capabilities 探测与落盘 + UI 展示，再推进 Codex thread_id 固化与 resume 多轮 e2e。

