# 2025-12-24_0254 — Provider 抽象 + Orchestrator e2e（fake）+ prevTurn 修复

## 做了什么
- Provider registry：`src/providers/provider_registry.js`
  - `codex`：真实 `codex exec`（现有实现）
  - `fake`：纯本地模拟（用于 e2e 测试，不依赖 CLI/登录）
- Fake provider：`src/providers/fake_exec.js`
- Orchestrator 修复：
  - Manager prompt 的 `LAST_*` 应引用“上一轮 turn（idx-1）”而不是当前新建 turn（否则永远拿到空日志）
  - 改为 `getTurnByIdx(runId, idx-1)`（见 `src/orchestrator/orchestrator.js`）
- 增加后端 e2e 脚本：`scripts/m1_e2e_fake.js`
  - 期望：Turn1 manager+executor；Turn2 manager 输出 `Done`；Run 状态为 `DONE`
- `package.json`：新增 `npm run m1:e2e:fake`

## 如何验证
- `npm run m1:e2e:fake`

## 结果
- e2e fake PASS：验证 Orchestrator 能自动回合并在 `Done` 时终止

## 下一步
- 更新 `约定.md` 当前进度到 M1/M2 已验收
- 补一份 README/运行手册（手机访问、安全配置、并发/白名单）

