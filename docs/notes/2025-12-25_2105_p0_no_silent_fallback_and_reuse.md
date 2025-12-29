# P0：强化“拒绝静默回退”与“优先复用”要求

## 背景

你明确要求把两条工程底线写进“通用公约/提示词”，并要求主管在验收时把这两条作为 P0 必查项：发现即返工、先修再推进。

- 0.4 拒绝兜底与静默回退
- 0.5 优先复用，禁止造重复轮子

## 变更

- `prompts/manager_system.md`：新增 P0 强制审查点（拒绝静默回退 + 优先复用），要求发现即返工。
- `prompts/executor_system.md`：新增 P0 强制工程原则（拒绝静默回退 + 优先复用）。
- `约定.md`：新增「评价官必查项（PASS 前提）」明确把两条作为硬门槛。
- `docs/templates/workspace_约定.md`：补齐“优先复用，禁止造重复轮子”条款（workspace 无自带 `约定.md` 时的默认注入公约）。

## 验证

- `npm run m1:e2e:fake` → PASS
  - 备注：Node v22 的 `node:sqlite` 仍会打印 ExperimentalWarning（已知情况）。

## 结论

两条工程底线已同时落位到：
- 默认 workspace 公约注入模板（通用项目）
- auto_codex 自身工程公约（本仓库）
- Manager/Executor 系统提示词（流程执行与验收）

