# 开发与测试

[中文](DEVELOPMENT.zh-CN.md) | [English](DEVELOPMENT.md)

## 本地启动

`npm run dev`

服务端会托管 `web/` 的静态前端，并提供 JSON API + SSE 事件流。

## 项目结构（概览）

- `src/`：后端（Express API、orchestrator、providers、storage、Ask、通知等）
- `web/`：前端（无构建步骤，纯 HTML/CSS/JS）
- `scripts/`：回归/e2e 脚本
- `prompts/`：Manager/Executor/Ask 的系统提示词与测试用 prompt

更详细的逐文件说明见：`docs/PROJECT_REPORT.md`。

## 测试

- `npm test`：核心回归套件（不依赖 Codex/Claude CLI）
- `npm run m2:api:e2e`：API 回归（fake provider）
- `npm run m4:ask:e2e`：Ask 回归
- `npm run m5:files:e2e`：Files 回归
- `npm run m6:notify:e2e`：通知回归（本地 mock PushPlus，不会真实推送）
- `npm run m7:ask:sse:e2e`：Ask SSE 回归（跨设备实时同步）

## 开发提示

- 为了“开箱即改即跑”，本项目刻意避免引入复杂的前端构建工具链。
- 建议小步改动：改一处模块 → 跑最贴近的 e2e → 再扩大回归范围。
