# 2025-12-24_0951 — Claude Provider 接入（claude -p / stream-json）

## 做了什么
- 新增 Claude provider：`src/providers/claude_exec.js`
  - `claude -p` 非交互调用，支持 `--output-format stream-json/json/text`
  - stream-json 自动加 `--verbose`（Claude Code 要求），可选 `--include-partial-messages`
  - stdout JSONL 落盘到 `events.jsonl`，并从 `type:"result".result` 提取最终 `lastMessage`（写入 `last_message.txt`）
  - 支持工具/权限相关配置：`tools/allowedTools/disallowedTools/permissionMode/sessionPersistence` 等（通过 session.configJson 透传）
- Provider registry 扩展：`src/providers/provider_registry.js` 支持 `claude`
- Orchestrator 支持 providerConfig 透传 + 记录 providerSessionId：`src/orchestrator/orchestrator.js`
- Store 增加 session providerSessionId 更新方法：`src/storage/store.js`
- UI 支持新建 session 选择 provider + claude 关键参数：`web/index.html`、`web/app.js`
- 后端 sessions API 增加 provider 校验（codex/claude/fake）：`src/server.js`
- 新增 Claude e2e（工具禁用，无副作用）：
  - `scripts/m1_e2e_claude_readonly.js`
  - `prompts/tests/m1_e2e_claude_*`
  - `npm run m1:e2e:claude`
- README 补充 claude provider 与验证命令：`README.md`

## 如何验证
- `npm run m1:e2e:fake`
- `npm run m1:e2e:claude`

## 结果
- 两个 e2e 均 PASS；claude provider 可在 Orchestrator 中完成 manager->executor->manager Done 的闭环

