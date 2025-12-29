# Ask（随口问）前端：独立窗口 + workspace 绑定

## 目标

- 在现有 Web UI 内新增一个“Ask（随口问）”页面，用于你看代码/日志时随口问一嘴。
- **默认打开新窗口**：主界面顶部按钮一键打开 `/ask?ws=<workspaceId>`，不打扰主流程页面。
- Ask **绑定当前 workspace**，后端 cwd 固定为该 workspace root；对话使用 resume 续聊。

## 前端改动

- `web/index.html`
  - 顶部增加 “随口问”按钮（新窗口）
  - Nav 增加 “随口问”页面
  - 新增 `page-ask`：线程列表 / 聊天区 / 配置区（支持导出 md/jsonl）
- `web/app.js`
  - 新增 ask 状态、渲染与操作：创建线程、选择线程、发送、导出、保存标题/配置、重置续聊、删除
  - 支持 URL：`/ask?ws=<workspaceId>` 自动进入 ask 页并选中 workspace
  - 中英双语覆盖 ask UI 文案（默认中文）
- `web/styles.css`
  - 新增 `.askGrid` 三栏布局（移动端自适应）
  - 新增 `.chat` 样式与 `textarea` 样式

## 验证

- `npm run m2:api:e2e` → PASS（回归不破坏后端 API）

