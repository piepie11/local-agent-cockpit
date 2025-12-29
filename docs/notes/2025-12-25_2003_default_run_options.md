# 2025-12-25 20:03 — 默认 Run 选项调整（更宽松）

## 需求
- 默认关闭：`requireGitClean`（要求 git 干净）、`dangerousCommandGuard`（危险命令防护）
- 默认参数调整：
  - `noProgressLimit` = 20
  - `maxTurns` = 1000
  - 单轮超时（UI 分钟）= 200

## 变更
- UI 默认值（Dashboard → Run options）：
  - `web/index.html`：默认回合/超时/无进展上限改为 1000/200/20；两项保护默认不勾选。
  - `web/app.js`：创建 run 时的 fallback 默认值同步为 1000/200/20。
- 后端默认值：
  - `src/orchestrator/orchestrator.js`：保护项改为 **显式 true 才开启**（未传 options 时默认关闭）；其余默认值改为 1000 turns / 200min / noProgressLimit 20。

## 验证
- `node -e "const fs=require('fs'); new Function(fs.readFileSync('web/app.js','utf8')); console.log('web/app.js parse OK');"`
- `npm run m2:api:e2e`（PASS）

## 说明
- 如需开启保护：创建 run 时在 options 里传 `requireGitClean: true` / `dangerousCommandGuard: true` 即可。

