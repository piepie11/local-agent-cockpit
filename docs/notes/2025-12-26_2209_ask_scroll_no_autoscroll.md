# Ask：恢复轮询时不强制滚动到底

## 问题

手机端在 Ask（随口问）页面里，用户手动把聊天记录往上滑（查看历史）后，过几秒会被自动拉回最底部，体验很差；尤其在“恢复中/发送中”状态下更明显。

## 根因定位

前端 `web/app.js` 的 `renderAskMessages()` 在每次渲染后都会无条件执行：

- `host.scrollTop = host.scrollHeight`

而 Ask 的恢复逻辑 `startAskRecoveryPoll()` 会每隔一段时间轮询并调用 `loadAskMessages()` → `renderAskMessages()`，导致“你一滚上去就被拉回底部”。

## 解决方案（实现要点）

改为“**仅当用户本来就在底部附近**时才自动跟随到底部”，否则保持当前滚动位置：

1) 渲染前记录：
   - `wasNearBottom = isNearBottom(host, thresholdPx)`
   - `prevScrollTop = host.scrollTop`
2) 渲染后：
   - 若 `wasNearBottom` 为真：滚动到底部（保持像聊天一样跟随新消息）
   - 否则：恢复 `scrollTop = prevScrollTop`（用户在看历史就不打扰）
3) 增加一个显式“强制到底部”开关 `state.askForceScrollToBottom`：
   - 切换线程、发送消息时置为 true，让用户期望的场景仍然自动到底部

涉及文件：
- `web/app.js`

## 如何验证

自动化：
- `npm run m4:ask:e2e`

手工（手机端）：
1) 打开 Ask 页，选择一个对话。
2) 在“恢复中/发送中”期间，把聊天框滚动条往上拖到历史消息处。
3) 等待 5~10 秒，确认不会被强制拉回底部。
4) 再滚动到接近底部，确认新消息到来时仍会自然跟随到底部。

