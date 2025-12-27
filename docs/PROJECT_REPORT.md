# local-agent-cockpit 项目全景报告（可脱离代码理解）

> 目标读者：第一次接手 `local-agent-cockpit`、需要在不看任何其它文档的情况下理解它是什么、怎么跑、架构怎么走、以及该去哪里改代码的人。  
> 语言：中文（仓库默认）。  
> 注意：本项目的本质是“通过 Web 远程控制本机 Agent/CLI 执行代码”，务必阅读本文的 **安全与权限模型**。

---

## 1. 这是什么项目（一句话 + 两句话）

**一句话**：`local-agent-cockpit` 是一个“手机可用”的本地 Web 控制台，用来编排 **Manager ↔ Executor** 的回合制协作（底层调用本机的 **Codex CLI** / **Claude Code CLI** / Fake provider），并把全过程做成可回放、可导出、可审计的运行记录。

**两句话**：
- 你在浏览器里选 workspace（目标代码仓库目录）+ 计划文件（`plan.md`）+ 两个会话（manager/executor），然后一键 Start/Step/Pause/Stop/Inject。
- 系统把每轮 prompt、输出、流式事件、stderr、最终消息、导出文件等全部落盘（`runs/`）并写入 SQLite（`data/app.sqlite`），前端通过 SSE 实时展示。

---

## 2. 5 分钟理解：核心对象模型（概念词典）

### 2.1 Workspace（工作区）
你要“被编排”的目标项目目录。Workspace 记录：
- `rootPath`：目标项目根目录（必须位于 allowlist 中）
- `planPath`：计划文件路径（默认 `<rootPath>/plan.md`）
- `conventionPath`：约定文件路径（默认 `<rootPath>/约定.md`，若没有则可回落到 `docs/templates/workspace_约定.md`）

### 2.2 Session（会话）
每个角色（manager/executor）各自绑定一个 provider 会话。
- `provider`：`codex` / `claude` / `fake`
- `providerSessionId`：用于“续聊/恢复”的 thread/session id（Codex 是 `thread_id`，Claude 是 `session_id`）
- `configJson`：该会话的运行配置（sandbox、mode、model、systemPromptPath…）

### 2.3 Run（一次编排运行）
Run = 在某个 workspace 上，用某个 managerSession + executorSession 按 `plan.md` 跑出的完整闭环。
- `status`：`IDLE/RUNNING/PAUSED/DONE/STOPPED/ERROR`
- `turnIndex`：当前第几轮（从 1 开始）
- `optionsJson`：该 run 的运行选项（超时、最大轮数、repoDigest、保护开关等）

### 2.4 Turn（回合）
Turn 是 Run 内的一个轮次：通常是 “Manager 产出指令包 → Executor 按指令执行并回报”。  
每个 Turn 会持久化：
- `managerPromptPath`（落盘）+ `managerOutput`（落库）+ `managerMetaJson`（落库）
- `executorPromptPath`（落盘）+ `executorOutput`（落库）+ `executorMetaJson`（落库）

### 2.5 Event（事件，SSE + 可回放）
事件是 UI 实时刷新的基础：后端把每条事件写入 SQLite（`events` 表），前端通过 SSE（`/api/runs/:id/events`）订阅并展示。

### 2.6 Ask（随口问）
Ask 是一个“轻量对话子系统”：它不是 Manager/Executor 编排，而是单线程的问答对话（支持续聊和终止），用于用户在读代码/日志时随口问问题。

---

## 3. 典型使用流程（从 0 到能跑）

### 3.1 启动服务
依赖：
- Node.js >= 22（使用 `node:sqlite`，会看到 experimental 提示）
- 可选：本机安装并登录 Codex CLI / Claude Code CLI（仅当你选择相应 provider）

启动（推荐一键）：
- Windows CMD：`up.cmd`
- Windows PowerShell：`.\up.ps1`
- macOS/Linux：`./up.sh`
- 通用：`npm run up`

运行时关键环境变量（见 `src/config.js`）：
- `ADMIN_TOKEN`：写接口鉴权口令（强烈建议设置）
- `ALLOWED_WORKSPACE_ROOTS`：可注册 workspace 的根目录白名单（`;` 或 `,` 分隔）
- `HOST` / `PORT`：监听地址（默认 `0.0.0.0:18787`）
- `DB_PATH` / `RUNS_DIR`：SQLite 与落盘目录（默认 `data/app.sqlite` 与 `runs/`）
- `MAX_CONCURRENT_RUNS`：全局并发 run 上限（默认 2）
- `READ_ONLY_MODE=true`：强制只读（所有写接口直接 403）

### 3.2 浏览器里跑一个 Run
1. Settings 页填 `ADMIN_TOKEN`（或从 `data/admin_token.txt` 读取）
2. 添加 workspace（rootPath 必须位于 allowlist 内）
3. 创建 manager/executor sessions（可用默认会话；也可自己选 provider/mode/model）
4. 创建 run，Start（自动模式）或 Step（单步模式）
5. 观察 Dashboard 的事件流、输出、repoDigest；必要时 Inject（手动插话纠偏）
6. 最终 Manager 输出 `Done` → run 自动结束；去 History 回放并 Export 导出

### 3.3 用 Ask（随口问）
1. 打开 Ask 页，新建线程（选 provider + sandbox + 可选 model/effort）
2. 发送问题：首条消息会 seed 并拿到 providerSessionId；后续消息走 resume（续聊）
3. 如果卡住/想中止：点“终止”，后端会 abort 当前线程并落一条 abort 的 assistant 消息
4. 可导出该 ask thread 为 `.md/.jsonl`

---

## 4. 输出契约（为什么 Manager/Executor 能被“编排”）

这是项目能稳定自动化的核心：**不靠“猜”，靠输出协议**（见 `prompts/manager_system.md`、`prompts/executor_system.md`，以及 workspace 约定文件：默认 `<workspace>/约定.md`，可参考 `docs/templates/workspace_约定.md`）。

### 4.1 Manager 输出必须二选一
- 未完成：输出 `<MANAGER_PACKET>...</MANAGER_PACKET>`（只允许一个包，不能额外闲聊）
- 已完成：输出严格等于 `Done`（无其它字符）

### 4.2 Executor 输出必须是 `<EXEC_LOG>`
Executor 每轮都输出一个 `<EXEC_LOG>...</EXEC_LOG>`，里面包含：
- 做了什么（SUMMARY）
- 改了哪些文件（CHANGES）
- 跑了哪些命令（COMMANDS）
- 验证结果（RESULTS）
- 风险/疑问（RISKS/QUESTIONS）

### 4.3 为什么要这么“死板”
因为后端需要做：
- 安全保护：从 EXEC_LOG 的 COMMANDS 检测危险命令（可选开关）
- 空跑检测：CHANGES 是否为空 + Manager 是否重复输出同样指令（可选开关）
- 结束判定：只认 `Done`，避免模型写“Done!”、“All done”等导致状态机误判

---

## 5. 架构总览（组件 + 数据流）

### 5.1 组件图（逻辑）

```
浏览器(web/)  ──HTTP/JSON──►  Express API (src/server.js)
   │                              │
   │                              ├─ SQLite Store (src/storage/*)
   │                              ├─ SSE Hub (src/sse_hub.js)  ──SSE──► 浏览器实时事件
   │                              ├─ Orchestrator (src/orchestrator/*)
   │                              │       │
   │                              │       ├─ Provider: codex/claude/fake (src/providers/*)
   │                              │       ├─ repoDigest (src/repo_digest.js)
   │                              │       └─ run_env + prompt 落盘 (runs/)
   │                              │
   │                              └─ Ask Service (src/ask/ask_service.js)
   │                                      └─ Provider: codex/claude/fake
   │
   └─ 静态资源：index.html/app.js/styles.css（无框架、无构建）
```

### 5.2 关键数据流：Run（Manager ↔ Executor）
1. UI 创建 Run 并点击 Start/Step
2. `src/orchestrator/orchestrator.js` 启动 run controller（并发/锁校验）
3. 每轮：
   - 读取 plan + convention + repoDigest
   - 组装 manager prompt（可能是 full 或 resume-delta）
   - 调用 provider（spawn `codex exec` / `claude ...`），采集流式事件/最终消息
   - 解析/规范化 Manager 输出（抽取 `<MANAGER_PACKET>` 或 `Done`）
   - 若 Done → 结束；否则组装 executor prompt → 调用 executor provider
   - 写入 turns/events 表，SSE 推送到前端
4. 达到终止条件：Done / Stop / Pause / Error / Guard 触发

### 5.3 关键数据流：Ask（随口问）
1. UI 发起 send：先落 user message 到 DB，然后异步跑 provider
2. 首条消息（seed）：带 system prompt，要求 provider 返回 providerSessionId
3. 后续消息（resume-only）：不重复 system prompt（靠 resume）
4. 可 stop：后端通过 AbortController 中止 spawn 进程树并落一条“已中止”的 assistant 消息

---

## 6. 安全与权限模型（必须理解）

### 6.1 写接口必须鉴权（ADMIN_TOKEN）
后端的 `requireAdmin`（`src/http/auth.js`）会检查 token：
- Header：`x-admin-token: <token>`
- 或 `Authorization: Bearer <token>`
- 或 `?token=<token>`（不推荐，容易被日志/历史记录泄露）

`READ_ONLY_MODE=true` 时，即使 token 正确也直接拒绝写操作。

### 6.2 Workspace 路径白名单（ALLOWED_WORKSPACE_ROOTS）
创建 workspace 时会校验 `rootPath` 是否在 allowlist 里（`src/http/paths.js`）。
这一步是为了避免“Web 端随便注册任意磁盘路径”，从而变成远程文件浏览器/执行器。

### 6.3 不要暴露到公网
项目默认监听 `0.0.0.0` 便于手机访问，但这也意味着：
- 如果你的机器直接暴露在公网，风险极高（等价“远程执行本机代码”）
- 推荐：仅内网/VPN（如 Tailscale）+ 强口令 + 反代 ACL/HTTPS

---

## 7. 数据与落盘（DB 表 + runs/ 目录）

### 7.1 SQLite：`data/app.sqlite`
由 `src/storage/schema.js` 定义表结构，`src/storage/store.js` 提供 CRUD。

主要表（按业务域）：
- `workspaces`：工作区注册表（rootPath/planPath/conventionPath）
- `sessions`：会话（角色、provider、providerSessionId、configJson）
- `runs`：编排运行（状态、turnIndex、optionsJson、错误信息）
- `turns`：每轮记录（prompt path + output + meta）
- `events`：事件流（用于 SSE/回放；按 seq 递增）
- `settings`：全局设置（如 capabilities 快照）
- `session_rollovers`：会话换血记录（from→to + summaryPath）
- `artifacts`：导出/落盘产物索引（export-md/json/jsonl 等）
- `ask_threads` / `ask_messages`：随口问线程与消息

### 7.2 runs/：可审计落盘
典型路径（见 `src/config.js`）：
- Run：`runs/<workspaceId>/<runId>/turn-XXX/manager|executor/`
  - `prompt.txt`（本轮 prompt）
  - `attempt-*/events.jsonl|stdout.log|stderr.log|last_message.txt`（provider 侧落盘）
  - `run_env.json`（环境信息、版本信息）
- Ask：`runs/ask/<workspaceId>/<threadId>/msg-YYYYMMDD_HHMMSS/`
  - `prompt.txt`
  - `attempt-*/...` 同上

### 7.3 repoDigest：把“仓库状态”注入 prompt
`src/repo_digest.js` 生成摘要，默认包含：
- 目录树（深度/行数截断）
- `git status --porcelain`
- `git diff --stat`

目的：让 Manager 能在不读全仓库的情况下做“下一步指令”。

---

## 8. API 设计（按域分组）

所有 API 都在 `src/server.js`。

### 8.1 Health & Capabilities
- `GET /api/health`：服务健康、allowlist、是否只读等
- `GET /api/capabilities`：读取 capabilities 快照（db → disk fallback）
- `POST /api/capabilities/probe`（admin）：探测 codex/claude CLI 版本与 flags，并持久化

### 8.2 Workspaces
- `GET /api/workspaces`：列出 workspaces
- `POST /api/workspaces`（admin）：创建 workspace（校验 rootPath allowlist；默认 plan/convention 路径）
- `DELETE /api/workspaces/:id`（admin）：删除 workspace（级联删 sessions/runs 等）
- `GET /api/workspaces/:id/plan`：读取 plan 文件内容（用于 Dashboard Plan tab）
- `GET /api/workspaces/:id/convention`：读取 convention 文件内容
- `GET /api/workspaces/:id/markdown?path=...`：读取 workspace 内任意 markdown（带 isInside 防穿越）
- `GET /api/workspaces/:id/repoDigest`：生成 repoDigest（可能较慢）
- `GET /api/workspaces/:id/sessions`：列出 workspace 下的 sessions
- `GET /api/workspaces/:id/runs`：列出 runs
- `GET /api/workspaces/:id/rollovers`：列出 session rollovers

### 8.3 Sessions
- `POST /api/sessions`（admin）：创建 session（role/provider/config）
- `PATCH /api/sessions/:id`（admin）：更新 provider/providerSessionId/config
- `POST /api/sessions/:id/rollover`（admin）：换血（创建新 session + 写 summary + 记录 rollovers；可选绑定 run 并替换 run 的 sessionId）

### 8.4 Runs（Orchestrator 控制面）
- `POST /api/runs`（admin）：创建 run（绑定 workspace + managerSessionId + executorSessionId + options）
- `GET /api/runs/:id`：获取 run 详情（含 turns + artifacts + options 解析）
- `GET /api/runs/:id/events`：SSE 订阅事件流（支持 last-event-id 断线续传）
- `POST /api/runs/:id/start`（admin）：自动模式运行
- `POST /api/runs/:id/step`（admin）：单步运行（跑 1 轮后自动 PAUSE）
- `POST /api/runs/:id/pause`（admin）：请求暂停
- `POST /api/runs/:id/stop`（admin）：停止（会杀掉当前子进程树）
- `POST /api/runs/:id/inject`（admin）：向 manager/executor 注入人类消息
- `GET /api/runs/:id/export?format=md|json|jsonl`（admin）：导出并落盘（同时写 artifacts 记录）

### 8.5 Ask（随口问）
- `GET /api/workspaces/:id/ask/threads`（admin）：列出 ask threads（workspace 内）
- `POST /api/workspaces/:id/ask/threads`（admin）：创建 ask thread
- `GET /api/ask/threads/:id`（admin）：获取 thread（含 busy 状态）
- `PATCH /api/ask/threads/:id`（admin）：更新 title/provider/providerSessionId/config（支持 reset）
- `DELETE /api/ask/threads/:id`（admin）：删除 thread
- `GET /api/ask/threads/:id/messages?limit=...`（admin）：列消息
- `POST /api/ask/threads/:id/send`（admin）：异步发送（先 ack 202，再后台跑 provider）
- `POST /api/ask/threads/:id/stop`（admin）：终止正在进行的发送
- `GET /api/ask/threads/:id/export?format=md|jsonl`（admin）：导出 ask

---

## 9. Orchestrator 细节（为什么它能稳定跑 + 如何保护）

实现文件：`src/orchestrator/orchestrator.js`、`src/orchestrator/prompt_builder.js`

### 9.1 两种会话模式：`stateless_exec` vs `stateful_resume`
会话模式来自 session 的 `configJson.mode`：
- `stateless_exec`：每轮都把 PLAN/CONVENTION/REPO_DIGEST 全量塞进 prompt（强审计、上下文可控、但大仓库成本高）
- `stateful_resume`：首轮 seed 全量上下文；后续可只发 delta（更省 token、更像“连续对话”）

实现要点：
- Orchestrator 会根据 `providerSessionId` 是否存在来判断是否 seed
- 对 Manager：当满足 “非 seed + 已确认 resume + includePlanEveryTurn=false” 时，可用 delta prompt（`buildManagerPromptResumeDelta`）
- 对 Executor：seed 时会注入 PLAN/CONVENTION/REPO_DIGEST + MANAGER_PACKET（`buildExecutorPromptResumeSeed`）

### 9.2 输出归一化（防模型跑偏）
`normalizeManagerOutput()` 会做两件关键事：
- 如果输出包含 `<MANAGER_PACKET>...</MANAGER_PACKET>`，只抽取该块（忽略其它文本）
- 如果最后一行是 `Done`，会把输出强制归一为严格 `Done`

这能显著减少“模型多说一句导致状态机误判”的问题。

### 9.3 保护开关（运行 optionsJson）
Run 的 `optionsJson` 支持（常用）：
- `maxTurns`：最大轮数，超过直接 ERROR
- `turnTimeoutMs`：每轮超时，触发 abort 并报错
- `repoDigestEnabled`：是否注入 repoDigest（默认 true）
- `requireGitClean`：每轮前要求 workspace `git status --porcelain` 为空，否则 PAUSE 并给出摘要
- `dangerousCommandGuard`：解析 Executor `<EXEC_LOG>` 的 COMMANDS，匹配危险命令模式则 PAUSE
- `noProgressLimit`：连续 N 轮“CHANGES 为空 + manager 指令重复”则 PAUSE（防空跑）

### 9.4 并发控制
- Workspace lock：同一 workspace 同时只能有 1 个 RUNNING run（防止互相改代码）
- 全局并发限制：`MAX_CONCURRENT_RUNS`（防止本机资源被打爆）

---

## 10. Provider 层（Codex / Claude / Fake）

实现文件：`src/providers/*`

### 10.1 统一的 Provider 运行接口
`provider.run({ prompt, cwd, outDir, sandbox, providerConfig, abortSignal, onStdoutJson, onStderrLine })`
返回结构（核心字段）：
- `exitCode/signal`
- `lastMessage`：最终消息（用于 Turn 的 managerOutput/executorOutput）
- `providerSessionId`：seed 时抽取并回写到 session.providerSessionId（用于 resume）
- `usedResume/usedJson/strategy/errors/paths`

### 10.2 Codex：`src/providers/codex_exec.js`
关键点：
- 多策略尝试：exec/resume + json/text（根据 mode、resumeId、jsonRequired、resumeOnly 等决定）
- 使用 `--output-last-message <path>` 稳定拿最终消息
- JSONL 模式下从 `thread.started` 事件抽取 `thread_id`
- 支持 Abort：收到 abortSignal 时 `taskkill /T /F`（Windows）或 `kill(-pid)`（类 Unix）

### 10.3 Claude：`src/providers/claude_exec.js`
关键点：
- 多策略尝试：resume/continue + stream-json/json/text（由 mode/resumeId/allowContinueFallback 等决定）
- stream-json 下聚合 text_delta，兜底生成 lastMessage
- 从输出 JSON 提取 `session_id` 和最终 `result`
- 同样支持 Abort（kill 进程树）

### 10.4 Fake：`src/providers/fake_exec.js`
用途：e2e 测试/回归测试，不依赖真实 CLI。
- 根据 prompt 内容返回固定的 `<MANAGER_PACKET>` / `<EXEC_LOG>` / `Done`
- 可模拟 delay 与 abort
- 可故意输出危险命令用于测试 guard

---

## 11. 前端 Web（无框架，移动端优先）

目录：`web/`

### 11.1 技术选型
- 纯原生：`index.html + app.js + styles.css`
- 无 React/Vue、无构建系统：启动即用、便于手机访问与离线调试

### 11.2 状态与持久化
`web/app.js` 维护一个全局 `state`，核心包括：
- `workspaceId`：当前 workspace（写入 localStorage + URL `?ws=`）
- `adminToken`：写接口 token（localStorage）
- `runs/sessions/askThreads/messages` 等页面数据缓存

### 11.3 实时事件（SSE）
前端通过 `EventSource` 订阅 `/api/runs/:id/events`：
- 断线后可用 `last-event-id` 续传 backlog（后端会从 events 表补发）
- UI 通过事件刷新“运行状态/输出/错误提示”等

### 11.4 页面分区（肉眼可定位的结构）
`web/index.html` 里按 page 分：
- Dashboard：workspace + sessions + run 控制 + Tabs（Manager/Executor/Events/Plan/Digest）
- History：按 run/turn 回放 prompt/output/meta，并支持搜索过滤
- Sessions：创建/编辑 session（provider/mode/model/sandbox/systemPromptPath…）
- Ask：随口问线程列表 + 对话窗口 + 配置
- Settings：health、capabilities 探测、添加 workspace

### 11.5 UI 细节优化（已做）
- 不同角色/区域使用不同颜色（manager/executor/ask/history）
- 长文本默认折叠（预览 3 行，点击展开）
- 移动端优化：响应式布局、避免横向滚动、按钮最小触控高度

---

## 12. 脚本与测试（回归保障在哪里）

目录：`scripts/`

### 12.1 启动器
- `scripts/up.js`：一键启动（挑端口、读写 `data/admin_token.txt`、注入 env）
- `up.cmd / up.ps1 / up.sh`：跨平台入口，调用 `scripts/up.js`

### 12.2 测试分层（从快到慢）
- `npm run m0:smoke`：验证 Codex CLI 封装可用（需要安装 Codex CLI）
- `npm run m0:roundtrip`：最小 Manager→Executor→Done 回合验证（需要 Codex CLI）
- `npm run m1:e2e:fake`：Orchestrator e2e（不依赖外部 CLI）
- `npm run m1:e2e:codex` / `m1:e2e:claude`：真实 provider 的只读 e2e
- `npm run m2:api:e2e`：API 深度 e2e（auth、allowlist、SSE、locks、guards、export…）
- `npm run m3:capabilities`：探测本机 CLI 能力并产出快照
- `npm run m3:e2e:*:resume`：stateful_resume 的稳定性验证（thread_id/session_id 抓取与续聊）
- `npm run m3:e2e:rollover`：换血链路验证
- `npm run m4:ask:e2e`：Ask 子系统 e2e（含 stop/abort）
- `npm run m2:deep` / `npm run m3:deep`：串行全量回归

---

## 13. 目录结构（人类视角）

> 说明：这里列的是“仓库中有意义的内容”；`node_modules/`、`runs/`、`data/` 这类要么依赖安装产物要么运行产物，不逐文件展开。

```
local-agent-cockpit/
  src/            # 后端核心：API/Orchestrator/Providers/Storage
  web/            # 前端（原生 JS/CSS，移动端优先）
  prompts/        # system prompt（Manager/Executor/Ask）+ e2e 测试 prompt
  scripts/        # 一键启动 + e2e/回归脚本
  docs/           # 文档 + 模板
  examples/       # 示例 workspace（开箱即用演示）
  .env.example    # 环境变量示例（安全占位符）
  README.md       # 快速开始与安全提示
  SECURITY.md     # 安全说明（务必阅读）
  LICENSE         # 开源协议
```

---

## 14. 文件级索引（逐文件：用途 + 读法）

> 说明：下面按 `git ls-files`（仓库追踪的文件）列出。  
> “实现”部分以**代码入口/核心函数/主要副作用**的形式描述，便于你直接跳转阅读。

### 14.1 根目录
- `.gitignore`：忽略 `runs/`、`data/`、`node_modules/`、`.env*` 等运行/依赖/机密产物
- `.env.example`：环境变量示例（安全占位符）
- `README.md`：快速开始、环境变量、基本 UI 流程、测试命令清单
- `SECURITY.md`：安全与部署注意事项（强烈建议先读）
- `LICENSE`：开源协议
- `CONTRIBUTING.md`：贡献指南
- `CODE_OF_CONDUCT.md`：行为准则
- `package.json`：Node 运行与脚本入口（`npm run dev/up/test` 等）
- `package-lock.json`：依赖锁定（当前主要依赖 express）
- `up.cmd` / `up.ps1` / `up.sh`：跨平台入口脚本（调用 `scripts/up.js`）

### 14.2 docs/
- `docs/README.md`：文档索引
- `docs/PROJECT_REPORT.md`：全景报告（架构/数据/文件级索引）
- `docs/CONFIGURATION.md`：环境变量与配置说明
- `docs/DEVELOPMENT.md`：开发与测试指南
- `docs/templates/workspace_约定.md`：workspace 的默认约定模板（当目标项目缺少约定文件时可回落）

### 14.3 prompts/
- `prompts/manager_system.md`：Manager 的系统提示词（职责、P0 审查点、输出契约）
- `prompts/executor_system.md`：Executor 的系统提示词（职责、P0 工程原则、EXEC_LOG 契约）
- `prompts/ask_system.md`：Ask（随口问）模式系统提示词（中文默认、尽量不改代码等）

#### prompts/tests/
- `prompts/tests/m1_e2e_codex_manager_system.md`：Codex e2e 的确定性 manager prompt
- `prompts/tests/m1_e2e_codex_executor_system.md`：Codex e2e 的确定性 executor prompt
- `prompts/tests/m1_e2e_claude_manager_system.md`：Claude e2e 的确定性 manager prompt
- `prompts/tests/m1_e2e_claude_executor_system.md`：Claude e2e 的确定性 executor prompt
- `prompts/tests/m3_e2e_codex_resume_manager_system.md`：Codex resume e2e（按 TURN_IDX 控制 Done）
- `prompts/tests/m3_e2e_claude_resume_manager_system.md`：Claude resume e2e（按 TURN_IDX 控制 Done）
- `prompts/tests/m3_e2e_mixed_manager_system.md`：Mixed resume e2e（短回合）

### 14.4 scripts/
- `scripts/up.js`：一键启动主逻辑（选端口、token 文件、spawn server）
- `scripts/up.cmd` / `scripts/up.ps1`：从 scripts/ 目录直接启动 up.js
- `scripts/codex_smoke.js`：Codex wrapper 烟雾测试（只读、必须回 OK）
- `scripts/lib/run_codex_exec.js`：给脚本用的 Codex exec 简化封装（与 src/providers/codex_exec.js 不同）
- `scripts/m0_roundtrip.js`：最小回合链路验证（Manager→Executor→Done）
- `scripts/m1_e2e_fake.js`：Orchestrator + fake provider 的端到端验证
- `scripts/m1_e2e_codex_readonly.js`：Orchestrator + codex provider 只读 e2e
- `scripts/m1_e2e_claude_readonly.js`：Orchestrator + claude provider 只读 e2e
- `scripts/m2_api_e2e.js`：HTTP API 深度 e2e（auth/allowlist/SSE/导出/保护开关/并发）
- `scripts/m3_capabilities.js`：capabilities 探测脚本（不调用模型）
- `scripts/m3_e2e_codex_resume.js`：Codex stateful_resume e2e（thread_id + usedResume）
- `scripts/m3_e2e_claude_resume.js`：Claude stateful_resume e2e（session_id + usedResume）
- `scripts/m3_e2e_mixed_resume.js`：Mixed provider 的 resume e2e
- `scripts/m3_rollover_e2e.js`：rollover（换血）API e2e
- `scripts/m4_ask_e2e.js`：Ask 子系统 e2e（含 stop/abort）
- `scripts/m5_files_e2e.js`：Files 子系统 e2e（浏览/预览/编辑保存）
- `scripts/m6_notify_e2e.js`：通知 e2e（本地 mock PushPlus，不会真实推送）
- `scripts/m7_ask_sse_e2e.js`：Ask SSE e2e（跨设备实时同步验证）

### 14.5 src/（后端核心）
- `src/server.js`：Express 服务入口；定义所有 API；静态托管 `web/`；组装 Store/SseHub/Orchestrator/AskService
- `src/config.js`：读取 env 并构造 config（port/host/adminToken/allowlist/dbPath/runsDir…）
- `src/sse_hub.js`：SSE 事件中心；支持 backlog 补发；把 store.events 以 seq 方式推送给浏览器
- `src/repo_digest.js`：生成 repoDigest（tree + git status/diffstat，带截断）
- `src/capabilities.js`：探测 codex/claude CLI 是否可用及 flags；持久化到 `data/capabilities.json`
- `src/exporters/run_export.js`：导出 run 为 md/json/jsonl；写入 runs/ 并记录 artifacts

#### src/http/
- `src/http/auth.js`：`requireAdmin` 中间件（token 提取 + READ_ONLY_MODE）
- `src/http/paths.js`：路径 allowlist 校验（isInside / isWorkspacePathAllowed）

#### src/storage/
- `src/storage/schema.js`：SQLite DDL（所有表）
- `src/storage/store.js`：Store 类（所有 CRUD + 简单迁移，如 `conventionPath`）

#### src/orchestrator/
- `src/orchestrator/orchestrator.js`：run 状态机；prompt 落盘；调用 provider；解析输出；guards；并发锁
- `src/orchestrator/prompt_builder.js`：集中构造 manager/executor prompt（full/seed/delta）

#### src/providers/
- `src/providers/provider_registry.js`：provider 分发（codex/claude/fake）
- `src/providers/codex_exec.js`：spawn `codex exec`；多策略尝试；抽取 thread_id；abort 进程树
- `src/providers/claude_exec.js`：spawn `claude`；多策略尝试；抽取 session_id；聚合文本；abort
- `src/providers/fake_exec.js`：本地假 provider（测试用）

#### src/ask/
- `src/ask/ask_service.js`：Ask 线程：异步发送、busy/stop、prompt 构造、导出 md/jsonl

#### src/lib/
- `src/lib/run_env.js`：落盘 `run_env.json`（node/cwd/platform/codex --version 等）
- `src/lib/spawn_capture.js`：简单 capture 子进程输出（repoDigest 用）
- `src/lib/spawn_capture_smart.js`：增强版 capture（Windows cmd wrapper / shell fallback / 记录 attempts）
- `src/lib/kill_tree.js`：跨平台 kill 进程树（Stop/Abort 用）
- `src/lib/line_buffer.js`：按行缓冲 stdout/stderr（解析 JSONL/stream-json）
- `src/lib/git_repo.js`：判断目录是否处于 git repo（决定是否加 `--skip-git-repo-check`）

### 14.6 web/
- `web/index.html`：单页应用骨架（导航、表单、各页面容器）
- `web/app.js`：前端主逻辑（状态、i18n、API 调用、SSE、渲染与交互）
- `web/styles.css`：主题与布局（暗/亮色、移动端优化、折叠/预览样式、角色颜色）

### 14.7 examples/（示例 workspace）
> 这些目录用于“开箱即用”演示：你可以直接把它们注册成 workspace，验证 UI 与核心链路。

- `examples/minimal-workspace/plan.md`：示例计划
- `examples/minimal-workspace/约定.md`：示例 workspace 约定

---

## 15. 想扩展/改造，建议从哪里下手（实操导航）

### 15.1 加新 API
- 看 `src/server.js`：按 domain 分段加路由
- 在 `src/storage/store.js` 里补齐 DB CRUD（如需持久化）
- 前端在 `web/app.js` 加 fetch 与渲染
- 最后加 e2e：优先 `scripts/m2_api_e2e.js`（无浏览器、跑得快）

### 15.2 加新 Provider
- 实现 `src/providers/<name>_exec.js` 暴露 `run<Name>Exec`
- 在 `src/providers/provider_registry.js` 注册
- 统一返回结构：`lastMessage/providerSessionId/usedResume/paths/errors`
- 为新 provider 加 e2e（可先 fake/readonly）

### 15.3 改编排策略（多角色/多并行）
建议优先阅读：
- `src/orchestrator/orchestrator.js`：状态机与事件模型
- `src/storage/schema.js`：对象模型能否承载（例如是否需要新增 role、并行 task 表等）
- `web/app.js`：UI 如何表达多角色并行（可能需要更结构化的数据）

---

## 16. 已知易踩坑（经验性）

- **编码/显示问题**：在某些终端/脚本里读取中文文件建议显式使用 UTF-8（例如 PowerShell 的 `Get-Content -Encoding UTF8`），否则容易出现乱码。
- **安全**：不要把 `ADMIN_TOKEN` 写进文档/截图/日志；不要用 query 参数传 token。
- **Windows 进程终止**：Stop/Abort 依赖 `taskkill /T /F`；如果你自定义 provider，要确保可可靠杀进程树。
- **node:sqlite**：Node 版本不足会直接跑不起来（需要 >= 22）。
