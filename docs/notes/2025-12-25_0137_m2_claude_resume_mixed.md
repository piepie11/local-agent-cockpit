# 留痕：Claude `stateful_resume` + 混搭（Codex↔Claude）e2e

## 做了什么
- Claude provider 升级：`src/providers/claude_exec.js`
  - `stateful_resume` 下自动开启 `sessionPersistence`（保证 seed 轮能拿到 `session_id`）
  - 支持 `--resume <session_id>`（以及可选 `--continue` 兜底：`allowContinueFallback`）
  - 降级链：`resume-stream-json -> resume-json -> (optional continue) -> exec-text`
  - Windows 调用改为 `cmd.exe /c claude ...`（避免 `.cmd/.ps1` 无法直接 spawn，且不使用 `shell:true`）
  - attempt 子目录落盘，并回传 `strategy/usedResume/usedJson/errors/providerSessionId`
- 新增 e2e：
  - `scripts/m3_e2e_claude_resume.js`（≥5 轮交替，断言 session_id 稳定且 turn>=2 走 resume）
  - `scripts/m3_e2e_mixed_resume.js`（manager=codex(resume) + executor=claude(resume)，短跑验证 resume 至少发生一次）
  - 对应 manager 测试 system prompt：`prompts/tests/m3_e2e_claude_resume_manager_system.md`、`prompts/tests/m3_e2e_mixed_manager_system.md`
- npm scripts：
  - `npm run m3:e2e:claude:resume`
  - `npm run m3:e2e:mixed:resume`

## 怎么验证
- `npm run m3:e2e:claude:resume`（PASS）
- `npm run m3:e2e:mixed:resume`（PASS）

## 结果
- Claude `stateful_resume` 的 session_id 固化 + 多轮 resume 已跑通；并验证至少 1 种混搭组合可用。

## 下一步
- 进入 M3：rollover（会话换血）+ UI/API 支持 + 回归/导出增强。

