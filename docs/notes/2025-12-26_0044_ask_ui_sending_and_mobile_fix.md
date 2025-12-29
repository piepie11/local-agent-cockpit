# Ask UI 修正：发送中标记 + 移动端右侧遮挡修复

## 问题

- Ask（随口问）发送时缺少“运行中/发送中”标记，用户无法判断是否在请求中。
- 手机端出现右侧内容被遮挡/裁切：通常由长路径/长字符串在窄屏下不换行导致横向溢出，然后被 `overflow-x: hidden` 裁掉。

## 改动

- Ask 发送状态可见化：
  - 新增状态 pill（`#askStatusPill`）：Idle / Sending…
  - 发送中按钮文案切换并禁用：`发送` → `发送中…`
- 移动端溢出修复：
  - `chat__meta`/`list__meta` 增加 `overflow-wrap:anywhere` + `word-break:break-word`，避免长路径撑破布局
  - `.askGrid > * { min-width: 0 }`，避免 grid 子项因 min-content 宽度导致横向溢出
  - 移动端 `.row > .hint` 设为 100% 宽，减少与按钮并排造成的挤压/遮挡

## 验证

- `npm run m4:ask:e2e` → PASS

