# M0-1 Smoke Test 严格化（Hardening）

## 修改点清单

### 1. codex_smoke.js 严格化判定
- exitCode !== 0 → 直接 FAIL
- signal !== null → 直接 FAIL
- stderr.log 非空 → 打印 WARN + 前 300 字符摘要（不直接 FAIL）
- 新增输出 `usedShell` 审计字段

### 2. run_codex_exec.js shell 风险收敛
- Linux/macOS: `shell: false`（更安全）
- Windows: `shell: true`（已知限制：.cmd 文件需要 shell 解析）
- 返回结果包含 `usedShell: true/false` 用于审计

### 3. plan.md 更新
- 移除 WSL 依赖表述，明确 Windows 原生支持
- 增加多 workspace 并行需求：
  - Workspace Registry（多项目注册）
  - 并行 Runs + workspace lock
  - 全局并发限制 `MAX_CONCURRENT_RUNS`
  - 落盘隔离 `runs/<workspaceId>/<runId>/...`
  - 目录白名单（安全）
- 清理无效 `:contentReference` 引用标记

### 4. 约定.md 更新
- 明确 Windows 原生为一等公民
- 增加 spawn/shell 规范：优先避免 `shell: true`，Windows 下为已知限制
- 增加多 workspace 并行约束（lock/并发/隔离/白名单）

## 环境信息

- **node**: v22.16.0
- **codex-cli**: 0.77.0
- **OS**: Windows 11
- **cwd**: `E:\sjt\others\auto_codex`

## 验证命令

```bash
node -v
codex --version
npm run m0:smoke
```

## 结果

- **生成目录**: `runs/smoke-20251224_000049/`
- **产物**:
  - `events.jsonl` (365 bytes) ✓
  - `last_message.txt` (2 bytes) — 内容: `OK` ✓
  - `stderr.log` (0 bytes) — 空，无警告 ✓
- **exitCode**: 0 ✓
- **signal**: null ✓
- **usedShell**: true（Windows 已知限制，审计记录）
- **校验**: `exitCode=0, signal=null, lastMessage="OK"` ✓ PASS

## stderr 情况说明

本次运行 `stderr.log` 为空（0 bytes），无需额外说明。

若 stderr 非空但 exitCode=0，判定为 PASS 的依据：
- exitCode=0 表示 codex 进程正常退出
- stderr 可能包含诊断信息（如重连日志），不影响最终结果
- 关键是 `last_message.txt` 内容符合预期

## 下一步

M0-1 验收通过后，进入 M0-2：创建 Manager/Executor system prompt，验证 Manager 能输出 `Done` 结束循环。
