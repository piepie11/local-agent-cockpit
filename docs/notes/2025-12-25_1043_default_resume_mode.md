# 留痕：默认切到 stateful_resume（含提示词一致性加固）

## 做了什么
- 默认 session mode 改为 `stateful_resume`（未显式填写 mode 时也会按 resume 处理）：
  - `src/orchestrator/orchestrator.js`：`normalizeSessionMode()` 默认返回 `stateful_resume`
- UI 默认行为对齐：
  - `web/app.js`：Dashboard 的 Create default sessions 默认创建 `mode=stateful_resume`
  - `web/index.html`：Create session 的 mode 下拉提示更新为默认 resume
- stateful_resume 的提示词一致性：
  - `src/orchestrator/prompt_builder.js`：
    - Manager 的 delta prompt 补回 git micro-loop 约束
    - Executor 的 seed prompt 补回 git micro-loop 约束
- 兼容/降级护栏：
  - `src/orchestrator/orchestrator.js`：仅在“确实成功使用过 resume”后才进入 manager 的 delta prompt；并保证 full prompt 也能拿到 repoDigest（full/delta 复用）
- 仓库 cleanliness：
  - `.gitignore`：忽略本地 demo workspace `test/`（避免影响 `require git clean`）

## 怎么验证
- `npm run m3:deep` → PASS

## 结果
- 新建 workspace 后，默认会以 `stateful_resume` 模式工作（更适合大仓库长任务）；仍可在 Sessions 页显式切回 `stateless_exec`。

