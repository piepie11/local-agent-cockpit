# Model + Reasoning Effort：Codex/Claude 会话配置补齐

## 目标

- 除了 `model` 可配置外，新增 `model_reasoning_effort`（low/medium/high/xhigh）配置项。
- `model` 支持“可输入 + 可选择”：先内置常用选项（Codex：gpt-5.1/gpt-5.1-codex/gpt-5.2/gpt-5.2-codex）。
- Claude 同步支持（根据 CLI 能力做合理映射）。

## 改动

### 后端 Provider

- Codex：`src/providers/codex_exec.js`
  - 读取 `model_reasoning_effort`（兼容 `modelReasoningEffort`）
  - 通过 `-c model_reasoning_effort="high"` 形式传给 Codex CLI
- Claude：`src/providers/claude_exec.js`
  - 读取 `model_reasoning_effort`（兼容 `modelReasoningEffort`）
  - Claude CLI 未提供同名参数，使用 `--append-system-prompt` 注入 `REASONING_EFFORT: <level>` 作为系统侧提示

### Web UI

- `web/index.html` / `web/app.js`
  - Sessions：新增 effort 下拉（创建/编辑）
  - Ask：新增 effort 下拉（保存到 thread config）
  - Model：输入框挂载 datalist（Codex/Claude 两套候选），并随 provider 自动切换候选列表

## 验证

- `npm run m3:deep` → PASS

