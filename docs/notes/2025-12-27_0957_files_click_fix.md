# Files：修复“点击文件无反应”（移动端/桌面端）

问题：Files 页文件列表在部分环境中点击“无反应”，表现为选中态/预览区都不更新。

根因：事件代理里直接使用 `e.target.closest(...)`。在某些浏览器里，`e.target` 可能是 Text 节点（不是 Element），从而触发 `closest is not a function`，导致点击逻辑中断。

## 修复点

- `web/app.js`
  - 增加 `eventTargetElement()`，把事件 target 归一成 Element 后再做 `.closest(...)`。
  - 覆盖 Files/History/Ask Threads 等用到事件代理的点击路径，避免同类问题重复出现。
- `web/app.js` / `web/styles.css`
  - Files 列表项改为 `<button type="button">`（更符合“可点击控件”语义，移动端点击更稳定）。
  - 为 `.list__item` 增加 `touch-action: manipulation`，减少移动端点击延迟/误触体验问题。

## 备注

- 若仍看起来“没生效”，通常是浏览器缓存了旧的 `app.js`；建议先强制刷新一次再验证。

