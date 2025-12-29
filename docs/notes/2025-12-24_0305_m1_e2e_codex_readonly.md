# 2025-12-24_0305 — Orchestrator e2e（codex / read-only）

## 做了什么
- 新增一组“确定性 codex e2e”资产：
  - `prompts/tests/m1_e2e_codex_manager_system.md`
  - `prompts/tests/m1_e2e_codex_executor_system.md`
  - `scripts/m1_e2e_codex_readonly.js`
- `package.json`：新增 `npm run m1:e2e:codex`

## 目的
在 **不改文件、不跑命令**（read-only sandbox）的前提下，验证：
- Orchestrator 回合循环（manager->executor->manager Done）
- codex provider 调用与落盘
- DB turns/events 写入

## 如何验证
- `npm run m1:e2e:codex`

## 结果
- PASS（本机可复现）

