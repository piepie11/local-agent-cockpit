# Mobile：model 选择改为可点选预设（替代 datalist）

## 问题

在手机端（Ask / Sessions）里选择 `model` 时，原来的 `<input list="...">`（datalist）交互不可用：只能手动输入，无法通过点击预设项来选择（点选会被输入框焦点/键盘打断）。

## 根因

移动端对 `<datalist>` 的支持不稳定（不同浏览器/版本行为差异大），导致“下拉建议”无法可靠点选。

## 解决方案

新增一个“model 预设” `<select>`（移动端原生 picker 体验稳定），并与原有 `model` 输入框双向同步：

- `select` 负责“点选预设模型”（移动端友好）。
- `input` 仍保留用于“自定义模型字符串”。
- 预设列表不重复维护：前端从页面已有的 `datalist#modelOptionsCodex/#modelOptionsClaude` 读取 `<option>` 并动态填充到 `select`。
- 当 provider 变化时（sessions 页），自动切换预设列表（codex/claude）。

覆盖位置：
- Sessions（创建/编辑会话）：`newSessionModelPreset`、`editSessionModelPreset`
- Ask（随口问配置）：`askModelPreset`

涉及文件：
- `web/index.html`
- `web/app.js`

## 验证方式

自动化（回归一条快的）：
- `npm run m4:ask:e2e`

手工（手机端）：
1) 打开 Ask 页，在配置区点击 `model（预设）` 下拉，能选择 `gpt-5.2-codex` 等并自动写入输入框。
2) Sessions 页：切换 provider=claude 后，`model（预设）` 下拉应变成 `sonnet/opus/...`；点选后写入 model 输入框。
3) 仍可在 model 输入框里手动输入自定义值；预设下拉会回到空（表示“非预设/自定义”）。

