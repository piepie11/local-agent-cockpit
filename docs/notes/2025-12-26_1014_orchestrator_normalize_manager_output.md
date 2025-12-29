# Orchestrator：规范化 Manager 输出（提取 Packet / Done 末行兜底）

## 背景

`npm run m3:deep` 中的 `m1:e2e:claude` 偶发失败：Claude 的 Manager 会输出一段解释文字后再输出 `Done`，导致 Orchestrator 认为 `MANAGER_OUTPUT_INVALID` 并暂停。

## 改动

- 在 Orchestrator 侧增加 `normalizeManagerOutput()`：
  - 若输出包含 `<MANAGER_PACKET>...</MANAGER_PACKET>`：提取 **第一个**完整 block 作为有效输出（忽略 block 外多余文本）。
  - 否则若最后一个非空行是 `Done`：将有效输出规范化为 `Done`（忽略前置解释）。
- 在事件与 turn meta 中记录是否发生了规范化（`coerced/kind`），并仍保留原始 `last_message.txt` 作为审计依据。

## 验证

- `npm run m3:deep` → PASS

