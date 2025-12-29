# 2025-12-29 00:55 — 修复 Run “无进展”循环检测（避免 100+ 轮卡死）

## 背景

出现过一次 Run 连续跑到 100+ 轮仍未自动停下的“死循环”：

- Executor 每轮都返回 `<EXEC_LOG>` 且 `CHANGES: None`（没有实际进展）
- Manager 每轮的 `GOAL/DIAGNOSIS` 会有小幅改写，但 `INSTRUCTIONS` 实质重复
- 现有 `noProgressLimit` 逻辑把 “Manager 指令是否相同” 简化为 **整段 Manager 输出的字符串相等**，导致轻微改写也会让计数归零，从而永远触发不了 `NO_PROGRESS` 自动暂停

## 改动

- `src/orchestrator/orchestrator.js`
  - 将 `noProgressLimit` 的“指令相同”判定改为基于 Manager 的 **INSTRUCTIONS 段落**生成稳定签名：
    - 提取 `<MANAGER_PACKET>` 里的 `INSTRUCTIONS:` 区块
    - 规范化：去掉编号/项目符号、统一大小写、压缩空白
    - 将反引号代码片段（如路径/命令）折叠为占位符，避免 `E:\` vs `E:/` 等差异导致签名不稳定
- `src/providers/fake_exec.js`
  - 新增 `loopManagerPacket` 配置：让 fake manager 持续输出 `<MANAGER_PACKET>`（GOAL 随 turn 变化，但 INSTRUCTIONS 保持不变），用于回归测试
- `scripts/m2_api_e2e.js`
  - 增加一条用例：`noProgressLimit=1` 时，fake manager 循环 + executor 无改动，应自动 `PAUSED` 且 `error=NO_PROGRESS`

## 验证

- 回归：`npm run m2:api:e2e`

