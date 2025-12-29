# 留痕：Codex `stateful_resume` 落地（thread_id 固化 + 多轮 resume e2e）

## 做了什么
- Codex provider 升级：`src/providers/codex_exec.js`
  - 从 JSONL `thread.started` 抽取 `thread_id` 并回传为 `providerSessionId`
  - 支持 `stateful_resume`：当 `providerConfig.mode=stateful_resume` 且存在 `providerConfig.resume` 时使用 `codex exec resume <id> -`
  - 降级链（单 provider 内部）：`resume-jsonl -> resume-text -> exec-jsonl -> exec-text`
  - Windows 调用改为 `cmd.exe /c codex ...`（避免 `.cmd/.ps1` 无法直接 spawn，且不使用 `shell:true`）
  - 产物按 attempt 子目录落盘，并在 meta 中记录 `strategy/usedResume/usedJson/errors`
- Orchestrator 升级：`src/orchestrator/orchestrator.js`
  - 读取 `sessions.configJson.mode`：`stateless_exec`（默认）/`stateful_resume`
  - `stateful_resume` 下按 seed/delta 构造 prompt，并把 `session.providerSessionId` 透传为 `providerConfig.resume`
  - Executor 在 seed 轮额外注入 `<PLAN>/<REPO_DIGEST>`（便于 executor 会话续聊）
  - 增加可选开关：`includePlanEveryTurn`（用于 e2e/调试，resume delta 仍可强制包含 plan）
  - Turn meta 增强：记录 `strategy/usedResume/usedJson/providerSessionId/providerMode/model/errors`
- Prompt 构造增强：`src/orchestrator/prompt_builder.js`
  - 新增 `buildManagerPromptResumeDelta`、`buildExecutorPromptResumeSeed`
  - 每轮统一注入 `TURN_IDX`（利于确定性测试与诊断）
- 新增 e2e：
  - `scripts/m3_e2e_codex_resume.js` + `npm run m3:e2e:codex:resume`
  - `prompts/tests/m3_e2e_codex_resume_manager_system.md`（TURN_IDX 驱动的确定性 manager）

## 怎么验证
- `npm run m1:e2e:codex`（PASS，确保旧链路不回归）
- `npm run m3:e2e:codex:resume`（PASS：turn>=6，turn>=2 时 manager/executor 均走 resume，thread_id 稳定）

## 结果
- Codex `stateful_resume` 的 thread_id 固化与多轮 resume 已可复现通过。

## 下一步
- 进入 M2：Claude `stateful_resume`（session_id 固化）+ 混搭 e2e；同步补齐导出/History 对 mode/model/降级原因展示。

