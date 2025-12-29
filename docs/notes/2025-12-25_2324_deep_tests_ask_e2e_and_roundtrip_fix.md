# Deep 测试补齐：Ask e2e + roundtrip 稳定性修复

## 背景

新增 Ask（随口问）功能后，需要补齐 e2e 覆盖并纳入 `m3:deep` 回归套件。

同时在一次 `m3:deep` 回归中发现 `m0:roundtrip` 偶发失败：Manager 在第二轮对 Executor 的 `<EXEC_LOG>` 进行“格式过严”验收，要求把 `CHANGES:` 等段落改成单行键值对，导致未输出 `Done`。

## 变更

- 新增 `scripts/m4_ask_e2e.js`：
  - 使用 `fake` provider（可复现）
  - 覆盖：创建 ask thread、seed/send、resume/send、messages 列表、导出 md/jsonl、删除 thread
- `package.json`：
  - 增加 `npm run m4:ask:e2e`
  - 将其纳入 `npm run m3:deep`
- `scripts/m0_roundtrip.js`：
  - 放宽 managerPrompt 的验收口径：把 `None` 与 `- None`、`N/A` 与 `- N/A` 视为等价（不要求 reformat），提升稳定性

## 验证

- `npm run m4:ask:e2e` → PASS
- `npm run m0:roundtrip` → PASS

