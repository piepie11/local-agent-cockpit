# M5c ask recovery minimal rerender

做了什么
- recovery/sync 走最小更新路径，避免调用全量 renderAskThread；保留输入框焦点/选区与滚动位置。
- Ask 恢复流程与 SSE refresh 改为更新 Ask 面板最小区域（messages/status/queue）。
- 新增可复现 headless CDP 验证脚本：`scripts/m5c_ask_recovery_focus_cdp.js`。

验证（headless Chrome + CDP）
- Command: `$env:CHROME_PATH = (Get-Command chrome.exe).Source; node scripts/m5c_ask_recovery_focus_cdp.js`
- Result summary: `{"focusOk":true,"valueOk":true,"selectionOk":true,"scrollOk":true,"scrollable":true,"recoveringStarted":true,"recoveringEnded":true,"messageCountBefore":16,"messageCountAfter":18,"messageAdvanced":true}`
- 断言覆盖：输入框 focus/选区/值保持；messages 滚动位置不跳；recovering 可进入/退出；消息更新完成。

回归
- npm test: pass
- npm run m4:ask:e2e: pass (SQLite ExperimentalWarning)
- npm run m7:ask:sse:e2e: pass (SQLite ExperimentalWarning)

下一步
- 等待下一步指令
