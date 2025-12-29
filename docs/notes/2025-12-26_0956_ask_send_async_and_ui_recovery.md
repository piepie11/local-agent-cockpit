# Ask 发送改为异步排队 + UI“恢复中”轮询

## 问题

- 移动端 Ask（随口问）点击“发送”后会长时间停留在发送中；网络波动/超时后直接报错，体验不符合“resume 可恢复”的预期。
- 用户更希望：输入后立即进入对话框，并显示“恢复中”（后台继续跑/可恢复），而不是一直等待 HTTP 返回。

## 改动

### 后端

- `POST /api/ask/threads/:id/send` 改为 **202 Accepted**：仅入库 user 消息并启动后台执行，立即返回 `{ ok:true, queued:true, userMessage, thread }`。
- Ask thread 对象新增 `busy: boolean`（由进程内锁推导），用于 UI 判断是否仍在执行。

### 前端

- Ask 发送后立即清空输入，并进入“恢复中”状态（按钮/状态 pill 文案切换）。
- 新增轮询：当 thread `busy=true` 时自动刷新 thread + messages，直到 `busy=false` 或超时。
- 发送接口网络异常时不再阻塞：保持“恢复中”并继续轮询，便于在移动端网络抖动下恢复 UI 状态。

## 验证

- `npm run m4:ask:e2e` → PASS（适配 send 202 + busy 轮询）

