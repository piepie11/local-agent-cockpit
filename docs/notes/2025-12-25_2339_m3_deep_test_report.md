# Deep 测试报告（m3:deep）

## 结论

`npm run m3:deep` 全量回归 **PASS**（含新增 Ask e2e）。

## 执行

- 命令：`npm run m3:deep`
- 时间：2025-12-25 23:25~23:39（本地）

## 覆盖项与结果

- `m0:smoke` → PASS（`runs/smoke-20251225_232511/`）
- `m0:roundtrip` → PASS（`runs/roundtrip-20251225_232519/`）
- `m1:e2e:fake` → PASS（`runs/e2e-fake-20251225_232629/`）
- `m1:e2e:codex` → PASS（`runs/e2e-codex-20251225_232632/`）
- `m1:e2e:claude` → PASS（`runs/e2e-claude-20251225_232713/`）
- `m2:api:e2e` → PASS（`runs/api-e2e-20251225_233144/`）
- `m3:capabilities` → PASS（`runs/capabilities-20251225_233157/`）
- `m3:e2e:codex:resume` → PASS（`runs/e2e-codex-resume-20251225_233202/`）
- `m3:e2e:claude:resume` → PASS（`runs/e2e-claude-resume-20251225_233329/`）
- `m3:e2e:mixed:resume` → PASS（`runs/e2e-mixed-resume-20251225_233815/`）
- `m3:e2e:rollover` → PASS（`runs/rollover-e2e-20251225_233936/`）
- `m4:ask:e2e` → PASS（`runs/ask-e2e-20251225_233938/`）

## 备注

- Node v22 的 `node:sqlite` 仍会打印 ExperimentalWarning（已知情况，不影响测试结果）。

