# 解决方案计划：对话连续（resume）+ 模型可选 + Web 全面控制台（Codex CLI / Claude Code CLI 双支持）

> 目标：在不推翻现有架构的前提下，把系统升级为：
> - 支持 “stateless exec（结构化审计）” 与 “stateful resume（强上下文）” 两种运行模式，并可在 Web UI 中切换；
> - Codex 与 Claude Code 都支持：会话连续（resume/continue）、模型可选、流式事件展示、聊天记录可回放/可导出；
> - 遇到 CLI 版本差异或 flag 不支持时自动降级，不让流程崩掉或空跑。

---

## 0. 术语与对象模型

- Provider：`codex` | `claude`
- Role：`manager` | `executor`
- Session：某个 Provider 下的一个“可续聊对话线程”
  - providerSessionId：
    - Codex：thread_id（JSON 事件里 thread.started 返回）
    - Claude：session_id（json output 里返回）
- Run：一次完整的“总管 ⇄ 执行者”自动编排运行
  - 绑定：workspace + plan + managerSession + executorSession + 配置
- Turn：Run 内的一轮（Manager → Executor），或半轮（仅 Manager / 仅 Executor）

### 0.1 当前仓库基线（已完成）

> 本 `plan.md` 是“升级计划”，不是从零搭建：现有仓库已具备 stateless_exec 的完整链路（Web + SSE + SQLite + Orchestrator + Provider + 测试）。

- 已有 stateless_exec：
  - Codex：`codex exec --json -o ...`（落盘 events.jsonl/last_message.txt）
  - Claude：`claude -p --output-format stream-json`（落盘 stream-json + last_message.txt）
- 已有编排闭环：Manager/Executor 轮换、Done 结束、Pause/Step/Stop/Inject、空跑检测、危险命令 guard、workspace 锁与全局并发限制
- 已有可回放与导出：History + Export（md/json/jsonl），runs/ 与 data/ 归位（gitignored）
- 已有回归命令：`npm run m2:deep`（串行跑 smoke/roundtrip/e2e/api-e2e）

本升级计划要补齐的核心：**stateful_resume（强上下文）+ mode/model 可配置 + capabilities 探测与自动降级 + 会话健康管理（rollover）**。

### 0.2 目录结构与文件归位（现状 + 未来新增）

- `src/`：服务端核心（建议新增功能优先放这里）
  - `src/server.js`：HTTP API + 静态 Web
  - `src/orchestrator/`：回合循环与状态机
  - `src/providers/`：CLI provider 封装（Codex/Claude/Fake）
  - `src/storage/`：SQLite schema + store
  - `src/lib/`：通用工具（spawn/kill/解析/落盘等）
- `web/`：前端（移动端优先）
- `scripts/`：验证与 e2e 脚本（所有新增模式都必须补脚本覆盖）
- `prompts/`：Manager/Executor system prompt（协议与约束的源头）
- `runs/`：运行产物落盘（events/logs/export/run_env.json 等，必须 gitignore）
- `data/`：SQLite 与状态文件（必须 gitignore）
- `docs/notes/`：留痕（每个小改动必须有）
- `docs/archive/plans/`：归档的历史计划（避免根目录多份 plan 混乱）

### 0.3 工程化推进与验收口径（必须）

- 每个可独立验证的小点，必须遵守 `约定.md` 微闭环：改动 → 验证 → 留痕（`docs/notes/`）→ git commit
- 任何自动降级/能力探测都必须“可解释”：
  - UI/History 能看到使用了哪条路径（exec/resume、json/transcript、model 透传方式）
  - 运行产物落盘（便于复盘与排障）

### 0.4 运行前置与配置（必须明确）

- 环境要求：
  - Node.js >= 22（使用 `node:sqlite`；运行时 experimental 提示可接受）
  - Git（用于 repoDigest / git clean / diffstat）
  - （按需）Codex CLI / Claude Code CLI：仅在对应 Provider 被启用时要求本机已安装并登录
- 关键配置（参见 `src/config.js`）：
  - `ADMIN_TOKEN`：写接口鉴权（Start/Stop/Pause/Inject/Export 等）
  - `ALLOWED_WORKSPACE_ROOTS`：可注册 workspace 的根目录白名单（支持 `;`/`,` 分隔）
  - `PORT` / `HOST`：Web 服务监听地址
  - `MAX_CONCURRENT_RUNS`：全局并发上限
  - `READ_ONLY_MODE`：只读模式（强制禁用写接口）
- 跨平台约束：不要求 WSL；Windows 原生为一等公民

### 0.5 范围边界（防发散）

- In-scope（本计划要交付）：
  - `stateful_resume`（Codex/Claude）+ `mode/model` 可配置（UI/DB/落盘）
  - capabilities 探测 + 自动降级链（可解释、可审计）
  - 会话健康管理（rollover）与空跑保护增强
- Out-of-scope（明确不做/后置）：
  - 全量 TypeScript 迁移（可作为后续独立计划）
  - 多用户/账号体系/公网部署方案
  - 自动化安装/登录 Codex/Claude（仅做能力探测与提示）

---

## 1. 中立评估：为什么大仓库在 stateless 下更低效？resume 的收益与代价

### 1.1 stateless exec（现状）优点
- 每轮输入固定（plan + repoDigest + lastLog），可重放、可审计、可控
- 输出结构化好做（JSONL events + last_message 文件/抽取）
- 上下文不会无限增长（你控制拼接内容）

### 1.2 stateless exec（现状）缺点
- 每轮重读：模型不会“自动记住上轮读过哪些文件”
- 大 repo 需要更大的 repoDigest，导致 token、延迟、成本显著上升
- 容易在多轮中重复工作（反复 `rg/ls/read`）

### 1.3 stateful resume（增强）优点
- 同一会话里保留对话/工具调用轨迹：更像“持续工作的 agent”
- repoDigest 可显著减量：只发 delta/关键变化即可
- 对大仓库更友好：减少重复探索与重复读文件

### 1.4 stateful resume（增强）代价
- 上下文会增长：跑很久可能“越来越慢/越来越贵/越跑越漂”
- CLI 不同版本/flag 兼容性差异：需要能力探测与降级
- 更依赖“会话健康管理”（见 6.6：session rollover）

结论：工程上要做成“可切换、可降级、可回放”的双模式，而不是一刀切。

---

## 2. 需求与验收标准（DoD）

### 2.1 必须做到
1) Web UI 可切换每个角色的：
   - Provider（codex/claude）
   - Mode：`stateless_exec` | `stateful_resume`
   - Model（字符串输入/下拉）
2) stateful_resume 下：
   - 能持续多轮交替（至少 5 轮）且 providerSessionId 保持一致（除非 rollover）
3) structured audit：
   - 两个 provider 都能在 UI 中看到“流式输出”
   - 每轮都能保存：prompt、final output、raw events（jsonl/stream-json）
   - 可在 History 中回放并导出（md/json/jsonl）
4) 可靠结束：
   - Manager 输出 Done（严格或近似）时 Run 停止
   - 达到 MAX_TURNS 或超时，自动暂停/停止并提示原因

### 2.2 建议做到（强烈）
- 能力探测：启动时检测本机 codex/claude 版本与关键 flag 支持情况
- 降级策略：某个模式失败自动降级（例如 codex resume json 不可用 → resume text → exec json）

---

## 3. 能力矩阵（实现时以“探测结果”为准）

### 3.1 Codex CLI（推荐命令形态）
- stateless_exec：
  - 支持：--json（JSONL 事件）、-o 输出最终消息、--output-schema（结构化输出）
  - 支持：--model / -m 或 -c model=...
- stateful_resume：
  - 支持：resume <SESSION_ID> / resume --last（但自动化建议不用 --last）
  - 注意：某些版本曾在 `--json resume --last <prompt>` 上有 bug；要做探测与降级

### 3.2 Claude Code CLI（print/headless）
- stateless_exec：
  - `claude -p "..." --output-format stream-json|json`
- stateful_resume：
  - `claude -p --resume <session_id> "..."` 或 `--continue`
  - 强烈建议自动化用明确 session_id（而不是 continue）

---

## 4. CLI 调用规范（关键：flag 顺序 & stdin prompt）

### 4.1 Codex：统一模板（强烈建议把 prompt 走 stdin）
> 关键原则：`codex exec` 的 flags（--json/-o/--model/--output-schema 等）放在 `resume` 前面；
> prompt 使用 `-` 从 stdin 读，避免引号/转义/超长参数。

#### 4.1.1 首轮（创建会话）
- Manager（只读）：
  - cmd：
    - `codex exec --json -o <outLast> --cd <workspace> --sandbox read-only -c model=<MODEL> -`
- Executor（写入）：
  - cmd：
    - `codex exec --json -o <outLast> --cd <workspace> --full-auto -c model=<MODEL> -`

> 首轮必须从 JSONL `thread.started` 事件里抓到 thread_id，写入 session.providerSessionId

#### 4.1.2 后续轮（resume 指定会话）
- Manager：
  - `codex exec --json -o <outLast> --cd <workspace> --sandbox read-only -c model=<MODEL> resume <THREAD_ID> -`
- Executor：
  - `codex exec --json -o <outLast> --cd <workspace> --full-auto -c model=<MODEL> resume <THREAD_ID> -`

#### 4.1.3 Codex 模型选择的两种方式
- 方式 A：`--model/-m`（写法同上，但放在 resume 前）
- 方式 B：统一用 `-c model=<MODEL>`（建议，便于和其他 config 一起透传）

> 允许在同一会话内切换 model，但默认策略建议“同一 Run 内固定 model”，避免漂移。

### 4.2 Claude：统一模板（stream-json + partial）
#### 4.2.1 首轮（创建 session_id）
- Manager：
  - `claude -p --output-format stream-json --include-partial-messages --model <MODEL> "<PROMPT>"`
  - 或先用 `--output-format json` 拿 session_id：
    - `claude -p --output-format json --model <MODEL> "<PROMPT>"` -> parse `.session_id`
- Executor（允许工具）：
  - `claude -p --output-format stream-json --include-partial-messages --model <MODEL> "<PROMPT>" --allowedTools "Bash,Read,Edit"`

#### 4.2.2 后续轮（resume）
- `claude -p --resume <SESSION_ID> --output-format stream-json --include-partial-messages --model <MODEL> "<PROMPT>" ...`

> 自动化推荐用 `--resume <session_id>`，不要只用 `--continue`（多会话并发会混）。

---

## 5. 输出抽取与统一事件模型（让 Web 端可解析/可审计）

### 5.1 内部统一事件（Web SSE / WS）
将 provider 的 raw events 映射成内部统一事件：
- RUN_STATUS：running/paused/stopped/done/error
- TURN_STARTED / TURN_ENDED
- ROLE_PROMPT（存储实际发送给 CLI 的 prompt）
- ROLE_PARTIAL（流式输出片段）
- ROLE_FINAL（最终输出文本）
- TOOL_EVENT（可选：命令执行/文件变更）
- PROVIDER_META（thread_id / session_id / model / version）

### 5.2 Codex JSONL 解析
- stdin prompt（你发给 codex 的文本）也要在 DB 里存一份（ROLE_PROMPT）
- JSONL stdout：
  - `thread.started`：抓 thread_id（首轮与续轮都会出现，续轮可校验一致）
  - `item.*`：
    - item.type=agent_message：可用于“更可靠的 final message”抽取
  - `turn.completed`：usage 可存档
- 同时保留原始 stdout JSONL（用于导出与追溯）

### 5.3 Claude stream-json 解析
- 把每行 JSON 作为 raw event 存档
- 如果 include partial：
  - 将 partial 文本片段做 ROLE_PARTIAL 推到 UI
- 最终拼出 ROLE_FINAL（并存档）

### 5.4 跨 Provider 的“内容块协议”（强建议继续使用）
为了在任何降级（纯 text 输出）下仍可稳定抽取：
- Manager 必须输出：
  - 完成：`Done`（严格）
  - 未完成：`<MANAGER_PACKET> ... </MANAGER_PACKET>`
- Executor 必须输出：
  - `<EXEC_LOG> ... </EXEC_LOG>`

抽取策略：
1) 优先使用 provider 的结构化事件拿 final message（Codex agent_message / Claude 最终 message）
2) 再从 final message 里用正则抽取最后一个 MANAGER_PACKET / EXEC_LOG
3) 若没有块，fallback 为整段文本

---

## 6. Orchestrator（编排器）升级计划

### 6.1 新增“会话模式”字段（每个 Session）
- mode：`stateless_exec` | `stateful_resume`
- model：string（统一字段）
- streaming：`jsonl` | `text`（Codex） / `stream-json` | `json`（Claude）
- schemaMode：`none` | `soft` | `strict`（可选）

> 工程建议：短期可把 `mode/model/streaming/schemaMode` 放在 `sessions.configJson`，保证零迁移上线；稳定后再按第 8 章做“表字段迁移”（减少解析/查询成本）。

### 6.2 Prompt 构造策略：stateless vs resume 不同拼法
#### 6.2.1 stateless_exec（审计模式）
每轮 Manager 输入：
- manager_system_prompt
- plan.md（全量或摘要）
- repoDigest（全量或摘要）
- lastExecutorLog（上轮）
- 明确要求：输出 Done 或 MANAGER_PACKET

每轮 Executor 输入：
- executor_system_prompt
- managerInstruction（MANAGER_PACKET）
- 附：必要 repoDigest delta（可选）

#### 6.2.2 stateful_resume（强上下文模式）
首轮（seed）：
- plan.md（全量）
- repoDigest（较全：tree + git status + diffstat）
- 系统提示词（manager/executor）
- 输出协议（Done / MANAGER_PACKET / EXEC_LOG）

后续轮（delta）：
- 只发：
  - lastLog（对方上轮输出）
  - “本轮目标/约束（简短）”
  - 若 git diff 有变化，附 diffstat；否则不发 repoDigest
- 让 agent 自己决定要不要再读文件（减少重复塞上下文）

### 6.3 Done 检测：更稳的结束条件
- `normalize(output)`：
  - trim
  - 去掉可能的包裹（例如 code fence）
- Done 判定：
  - 严格：output == "Done"
  - 宽松（可开关）：output in {"Done","DONE","done"} 或 MANAGER_PACKET 内 status=done

### 6.4 空跑检测（避免一直循环）
- 连续 N 轮：
  - executor 的 CHANGES 为空
  - 且 manager 指令高度重复
  => 自动 PAUSE，并提示 UI 需要人工 inject 或切换模式

### 6.5 能力探测（强烈建议实现）
启动时探测：
- `codex --version`、`claude -v`
- Codex 探测项：
  - 是否支持 `codex exec --json`
  - 是否支持 `codex exec --json ... resume <id> -`（可用一个临时只读 session 做 probe）
  - 是否存在 `--json resume --last <prompt>` bug（不依赖 --last，probe 可跳过）
- Claude 探测项：
  - `-p --output-format stream-json` 是否可用
  - `--include-partial-messages` 是否可用

探测结果写入：
- settings.capabilities
- UI 显示：✅/⚠️/❌

### 6.6 会话健康管理：Session Rollover（解决 resume 越跑越大）
触发条件（任一满足）：
- turnIndex 超过阈值（例如 30）
- 最近 N 轮平均响应时间显著上升
- UI 手动点击 “Rollover”

执行策略：
1) Orchestrator 生成“滚动摘要”（rolling summary）：
   - plan.md 完成进度
   - 已确认的关键结论/改动点
   - 未解决阻塞
2) 新建一个 session（同 provider/role）
3) 用 seed prompt 注入 summary + 当前 repoDigest delta
4) 继续 Run，但记录：
   - oldSessionId -> newSessionId 的关联链路（History 可追溯）

---

## 7. Web（UI/后端）全面升级项

### 7.1 UI：Session 管理页（必须增强）
- 列表显示：
  - role、provider、mode、model、providerSessionId、最近活跃、capabilities 状态
- 操作：
  - New Manager Session / New Executor Session
  - Switch Provider（codex/claude）
  - Switch Mode（exec/resume）
  - Set Model
  - (Claude) Fork Session（可选）
  - Reset Session（新建替换旧绑定）
  - Copy session_id / thread_id（便于调试）

### 7.2 UI：Run Dashboard（核心增强）
- 顶栏配置：
  - Manager：provider/mode/model
  - Executor：provider/mode/model
  - MAX_TURNS / timeout / strict Done toggle
- 控制：
  - Start / Pause / Step (manager-only / executor-only / full) / Stop
  - Inject（给 manager 或 executor 插入一条“人工指令”）
  - Rollover（手动触发会话换血）
- 视图：
  - Manager 流式输出（按轮次折叠）
  - Executor 流式输出
  - Raw events（可切换：jsonl/stream-json 原始行）
  - Artifacts：导出下载（md/json/jsonl）

### 7.3 UI：History（回放增强）
- Run 列表 + 轮次回放
- 每轮展示：
  - prompt（可折叠：看“实际发给 CLI 的完整文本”）
  - final output
  - raw events
- 搜索：
  - 关键词、失败轮次、包含某文件名/命令

### 7.4 后端：API 扩展
- /api/capabilities（返回探测结果）
- /api/sessions/:id/rollover（生成新 session 并返回）
- /api/runs/:id/export（支持 md/json/jsonl）
- /api/runs/:id/events（SSE：支持断线续传）

---

## 8. 数据库/存储迁移（在不破坏旧数据的前提下）

### 8.1 sessions 表新增字段
- mode TEXT
- model TEXT
- capabilitiesJson TEXT
- providerSessionId TEXT（已有则复用）
- lastTranscriptPath TEXT（降级时用于落盘）

### 8.2 turns/events 表增强
- turns 增加：
  - managerProviderMetaJson / executorProviderMetaJson
  - stdoutPath/stderrPath（可选）
- events 存 raw 行（jsonl/stream-json） + 统一事件映射结果

---

## 9. 降级策略（保证“能跑”优先）

### 9.1 Codex 降级链
优先级：
1) resume + jsonl + -o（最佳：强上下文 + 可审计）
2) resume + text + stdout/stderr transcript（可审计弱一些，但上下文强）
3) stateless exec + jsonl + -o（回到现状）
4) stateless exec + text（最差但可用）

### 9.2 Claude 降级链
1) resume + stream-json + partial（最佳）
2) resume + json（可解析但不流畅）
3) continue + stream-json（不推荐但可用）
4) stateless -p + stream-json（回到现状）

---

## 10. 测试计划（必须做，不然线上会反复翻车）

### 10.1 单元测试
- Codex JSONL parser：thread.started、agent_message、turn.completed
- Claude stream-json parser：partial 拼接、final 抽取、session_id 抓取
- Done 检测：严格/宽松、含 code fence 的情况
- 降级链：模拟“flag 不支持/进程非 0”时的 fallback

### 10.2 集成测试（本机需安装 codex/claude）
- Codex：
  - 首轮 exec json 拿 thread_id
  - 后续 resume 指定 id 连续 3 轮
  - 断言：thread_id 不变、events 可解析
- Claude：
  - 首轮 json 拿 session_id
  - 后续 resume 连续 3 轮
  - 断言：session_id 不变、stream-json 可解析

### 10.3 E2E（可选）
- Playwright：移动端 viewport 下 Start/Pause/Inject/History/Export 跑通

### 10.4 验收脚本与覆盖关系（建议补齐）

- 现有回归（已具备）：
  - `npm run m2:deep`：覆盖 stateless_exec 基线（smoke/roundtrip/e2e/api-e2e）
- 本计划新增（需补齐到 scripts + package.json）：
  - `npm run m3:capabilities`：codex/claude capability 探测可复现
  - `npm run m3:e2e:codex:resume`：Codex resume 连续多轮（>=3）+ thread_id 固化
  - `npm run m3:e2e:claude:resume`：Claude resume 连续多轮（>=3）+ session_id 固化
  - `npm run m3:e2e:mixed:resume`：至少 1 种混搭组合跑通（含 Pause/Inject/Export）
  - `npm run m3:e2e:rollover`：rollover 后可继续运行 + History 可追溯

---

## 11. 里程碑与交付

### M1（最关键）：Codex resume 真正可用且不丢审计
目标：让 Codex 在 `stateful_resume` 下能连续多轮不丢上下文，同时保留“足够的审计与可回放”。

涉及模块（预计改动面）：
- Provider：`src/providers/codex_exec.js`（命令构造/解析/thread_id/resume/降级）
- Orchestrator：`src/orchestrator/orchestrator.js`、`src/orchestrator/prompt_builder.js`（mode/model/seed/delta）
- Storage：`src/storage/schema.js`、`src/storage/store.js`（sessions 元信息/落盘索引）
- API/UI：`src/server.js`、`web/app.js`、`web/index.html`（mode/model UI、capabilities、history 展示）
- Scripts：`scripts/`（capabilities + resume e2e）

任务拆解（建议按顺序小步闭环）：

1) **capabilities 探测（P0）**
   - 探测内容：`codex --version`、`codex exec --help`、`codex exec resume --help`（以及必要的最小试跑）
   - 输出：保存 capabilities 快照（落库 + 落盘），UI 可查看
   - 验证：新增脚本 `scripts/m3_capabilities_codex.js`（或同等）可复现输出，并纳入 `npm run m3:capabilities`

2) **Session 增强：mode/model/providerSessionId**
   - UI：Manager/Executor 各自可切换 `mode`/`model`
   - DB：sessions 持久化 `mode`/`model`/`capabilitiesJson`（或短期先落在 `configJson`，随后按第 8 章迁移）
   - 验证：API e2e 覆盖 sessions 字段读写

3) **thread_id 抓取与固化（首轮 exec）**
   - 从 JSONL `thread.started` 抽取 `thread_id`，写回 session.providerSessionId
   - 验证：新增单测/脚本覆盖“抽取正确 + 可复现”

4) **resume 多轮稳定跑（指定 thread_id）**
   - 默认优先尝试：`codex exec --json -o ... resume <thread_id> -`
   - 若某版本不支持/不稳定：自动降级为 transcript 路径（stdout/stderr 落盘 + 最终消息抽取）
   - 验证：新增 `scripts/m3_e2e_codex_resume.js`（至少连续 3 轮）

5) **审计与回放**
   - UI/History 能清晰看到：每轮的 prompt、final、raw events 或 transcript
   - Export（md/json/jsonl）包含关键元信息：mode/model/降级原因/thread_id

验收（DoD）：
- UI 可为 Manager/Executor 分别选择 `provider=codex`、`mode=stateful_resume`、`model=<string>`
- 连续 ≥ 5 轮交替后 providerSessionId 仍保持一致（除非显式 rollover）
- 若发生降级（例如 resume 无 JSONL）：History 可解释降级原因，且最终消息抽取稳定（不中断编排）

建议回归命令：
- `npm run m2:deep`
- `npm run m3:e2e:codex:resume`（新增）

### M2：Claude resume 完整接入 + 双 Provider 混搭
目标：把 Claude 的 session_id/--resume 与 mode/model 配置打通，并验证“混搭”可用。

涉及模块（预计改动面）：
- Provider：`src/providers/claude_exec.js`（resume/session_id 抓取/降级链/partial 拼接）
- Orchestrator：`src/orchestrator/orchestrator.js`、`src/orchestrator/prompt_builder.js`
- API/UI：`src/server.js`、`web/app.js`
- Scripts：`scripts/`（claude resume e2e + mixed e2e）

任务拆解：

1) capabilities 探测（claude）：版本/flag 支持（stream-json/json、resume、model）
2) 首轮抓取 `session_id` 并固化到 session.providerSessionId
3) `stateful_resume` 下连续多轮：`--resume <session_id>`（必要时降级）
4) 混搭场景：
   - manager=codex(resume) + executor=claude(resume)
   - manager=claude(resume) + executor=codex(resume)
5) History/Export：保持统一事件模型（SSE）与审计落盘

验收（DoD）：
- UI 可为 Manager/Executor 分别选择 `provider`/`mode`/`model`
- Claude `stateful_resume` 连续 ≥ 5 轮 providerSessionId 不变
- 混搭至少 1 种组合可跑通（含 Pause/Inject/Export）

建议回归命令：
- `npm run m2:deep`
- `npm run m3:e2e:claude:resume`（新增）
- `npm run m3:e2e:mixed:resume`（新增）

### M3：会话健康管理（rollover）+ 空跑保护
目标：解决 resume 长任务的“上下文膨胀”，让长跑更稳、更省、更可控。

涉及模块（预计改动面）：
- Orchestrator：`src/orchestrator/orchestrator.js`（rollover 触发/链路记录/seed 注入）
- Prompt：`src/orchestrator/prompt_builder.js`（rolling summary 模板）
- Storage：`src/storage/store.js`、`src/storage/schema.js`（session 链路与摘要落库/落盘索引）
- API/UI：`src/server.js`、`web/app.js`（rollover 按钮、链路展示）
- Scripts：`scripts/`（rollover e2e）

任务拆解：

1) Rollover 触发条件与 UI 操作
   - 自动：turnCount/耗时/成本阈值（可配置）
   - 手动：Dashboard 一键触发
2) Rolling summary 生成（固定模板）
   - 完成进度、关键结论、未解决阻塞、下一步建议
3) 新 session 种子注入
   - 创建新 session 并写入 seed prompt（summary + repoDigest delta）
   - 记录链路：oldSessionId → newSessionId（History 可追溯）
4) 验证与回归
   - `scripts/m3_rollover_e2e.js`（或同等）覆盖“rollover 后能继续跑 + 可回放”

验收（DoD）：
- UI 可触发 rollover；History 能追溯 session 链路
- rollover 后继续运行不丢控制能力（Pause/Inject/Export）
- 降级/探测/rollover 的原因都可审计（落盘 + 可导出）

---

## 12. 最终验收场景（你出差用手机即可操作）
- 手机打开 Dashboard
- 选择 workspace + 绑定 plan.md
- 新建 manager/executor session（分别选择 provider/mode/model）
- Start：看到流式输出
- 中途 Pause/Inject
- 最终 Done 自动停止
- History 回放全链路并导出 md/jsonl

