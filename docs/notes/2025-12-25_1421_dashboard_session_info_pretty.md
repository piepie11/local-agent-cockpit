# 2025-12-25 14:21 — Dashboard 会话属性展示美化

## 背景
- Dashboard 之前直接用 `<pre>` 展示完整 JSON，信息量大但不友好，用户反馈“太难看/难读”。

## 变更
- Dashboard 会话属性改为“键值表（kv）”展示核心字段（ID/角色/provider/续聊ID/mode/model/sandbox/prompt/时间）。
- 将完整配置 `configJson` 放到可折叠的“原始配置（JSON）”里，按需查看。
- 增加相关样式：`sessionInfo` 卡片、`kv--wrap/kv--compact`、`details` 美化。

## 验证
- `node -e "const fs=require('fs'); new Function(fs.readFileSync('web/app.js','utf8')); console.log('parse OK');"`

## 结果
- Dashboard 默认展示更易读；需要深挖时再展开 raw JSON。

