# 2025-12-24_2151 — 测试：fake provider 增强（delay / dangerous）

## 做了什么
- 扩展 `src/providers/fake_exec.js`：
  - 支持 `providerConfig.delayMs`：用于稳定复现“并发/锁/注入时序”等测试场景
  - 支持 `providerConfig.dangerousExecLog`：用于覆盖 Orchestrator 的 `dangerousCommandGuard` 分支

## 如何验证
- `npm run m1:e2e:fake`

## 结果
- PASS

