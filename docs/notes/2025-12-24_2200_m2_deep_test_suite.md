# 2025-12-24_2200 — 深度测试补齐（API e2e + 一键 deep 回归）

## 做了什么
- 新增后端 API e2e：`scripts/m2_api_e2e.js`
  - 覆盖：ADMIN_TOKEN、workspace allowlist、sessions/provider 校验、runs 控制、SSE 基础、export、并发/锁、危险命令保护、git clean 保护
- 新增 npm scripts：
  - `m2:api:e2e`
  - `m2:deep`（串行跑一套核心回归）

## 如何验证
- `npm run m2:api:e2e`
- `npm run m2:deep`

## 结果
- 本机运行 `npm run m2:deep` 全部 PASS（含 codex/claude/fake + API e2e）

