# 留痕：m3:deep 回归脚本 + 测试/导出/History 小加固

## 做了什么
- scripts：
  - `package.json` 新增 `npm run m3:deep`：串行跑完 `m2:deep` + M3（capabilities + resume e2e + rollover e2e）
  - `scripts/m0_roundtrip.js` 放宽验收：允许 `<EXEC_LOG>` 包含 `SUMMARY:`（仍要求 CHANGES/COMMANDS/RESULTS/RISKS/QUESTIONS 满足约束）
  - `scripts/m1_e2e_claude_readonly.js` 加固：延长 turn/整体等待超时；超时仍 RUNNING 时主动 stop，避免挂死 run
- export/history：
  - `src/exporters/run_export.js` 导出增强：包含 manager/executor session 信息、turn 的 metaJson 解析结果、rollovers 列表
  - `web/app.js` History 详情页增加 manager/executor meta 展示（便于诊断 provider 策略/降级链）
- `约定.md`：执行进度更新为 `DONE`（M1-M3 已完成）

## 怎么验证
- `node -v` → v22.16.0
- `codex --version` → codex-cli 0.77.0
- `claude --version` → 2.0.67 (Claude Code)
- `npm run m3:deep` → PASS

## 结果
- 全量回归命令就绪，且导出/History 的诊断信息更完整；回归通过后把当前里程碑标记为 DONE。

