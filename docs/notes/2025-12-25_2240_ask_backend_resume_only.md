# “随口问（Ask）”后端：workspace 绑定 + resume-only

## 目标

实现一个不打扰主流程（Manager/Executor run）的“随口问”通道：

- **绑定 workspace**：每个 Ask thread 固定在一个 workspace 下，CLI 的 `cwd` 永远是该 workspace 的 `rootPath`。
- **resume-only**：Ask thread 一旦建立续聊 id（Codex thread_id / Claude session_id），后续只允许 resume，不允许静默回退到新对话。
- **落盘可追溯**：每次 Ask 发送都在 `runs/ask/...` 下落盘 prompt、events/stdout、stderr、last_message、run_env。

## 主要实现

### DB

- `ask_threads`：workspaceId/title/provider/providerSessionId/configJson/时间戳
- `ask_messages`：threadId/role/text/metaJson/createdAt

### Provider 侧“拒绝静默回退”强化

- `src/providers/codex_exec.js`
  - 新增 `resumeOnly`：有 resumeId 时只尝试 `codex resume`，不再 fallback 到 `codex exec`（避免静默开新 thread）
  - 新增 `jsonRequired`：需要时只跑 `--json` 路线
  - 新增 `requireProviderSessionId`：用于 seed 轮强制拿到 thread_id（否则视为失败）

### Ask 服务

- `src/ask/ask_service.js`
  - `sendAskMessage()`：写入 user 消息 -> 调 provider -> 写入 assistant 消息 -> 更新 providerSessionId
  - 使用 `prompts/ask_system.md` 作为 Ask 的系统提示词（seed 轮注入）

### API（全部需要 ADMIN_TOKEN）

- `GET  /api/workspaces/:id/ask/threads`
- `POST /api/workspaces/:id/ask/threads`
- `GET  /api/ask/threads/:id`
- `PATCH/DELETE /api/ask/threads/:id`
- `GET  /api/ask/threads/:id/messages`
- `POST /api/ask/threads/:id/send`
- `GET  /api/ask/threads/:id/export?format=md|jsonl`

## 验证

- `npm run m2:api:e2e` → PASS
- `npm run m1:e2e:fake` → PASS

