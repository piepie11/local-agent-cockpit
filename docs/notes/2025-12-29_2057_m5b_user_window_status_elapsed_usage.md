# M5b user window status/elapsed/usage

做了什么
- 为 Codex 用户窗口加入状态 pill（就绪/回复中/恢复中/失败），并统一状态渲染逻辑。
- 记录本次发送起止时间，展示耗时；无法计算时显示 `—` 并说明原因。
- 尝试从消息 meta 解析 usage，存在则展示；否则显示 `—` 并提示 provider 未提供。

怎么验证
- npm test
- npm run m4:ask:e2e
- npm run m7:ask:sse:e2e

手动验收要点
1) 发送消息后状态变为“回复中”，完成后回到“就绪”。
2) 恢复轮询时显示“恢复中”。
3) 失败/错误时状态显示“失败”。
4) 一次对话完成后显示耗时；刷新后耗时显示 `—` 且有说明。
5) usage 无数据时显示 `—` 且有说明（当前 provider 未提供）。

结果
- npm test：通过
- npm run m4:ask:e2e：通过（SQLite experimental warning）
- npm run m7:ask:sse:e2e：通过（SQLite experimental warning）

下一步
- 进入 M5c（恢复刷新最小化）。
