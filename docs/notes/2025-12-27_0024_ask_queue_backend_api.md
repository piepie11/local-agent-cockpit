# Ask 队列（后端 worker + API）

目标：在不改变 Ask “resume 续聊”核心逻辑的前提下，让 `/send` 在 busy 时也能接收请求并排队执行，同时提供队列项的查询/编辑/删除接口，便于前端实现排队面板。

## 核心机制

- `/api/ask/threads/:id/send`：不再因为 busy 返回 409，而是 **永远 enqueue** 一条 `ask_queue_items`。
- worker（按 thread 串行）：
  - `claimNextAskQueueItem()` 原子领取下一条 queued → 标记 running
  - 执行时才调用原有 `prepareAskSend()`/`finalizeAskSend()`，保证“编辑队列项”对最终发送内容生效
  - 成功：删除队列项
  - 失败/中止：队列项标记 `error`（并写入 `error/endedAt`），方便 UI 显示与手动删除

## 新增 API

- `GET /api/ask/threads/:id/queue?limit=...`
  - 返回该 thread 的队列项（running/queued/error）
- `PATCH /api/ask/queue/:id`
  - 仅允许 `status=queued` 编辑 `text`
- `DELETE /api/ask/queue/:id`
  - 允许删除 queued/error；running 返回 409

## 兼容性提示

- `/send` 的响应从 `userMessage` 变为 `queueItem`（前端需适配：消息会在“执行时”落入聊天记录）

