# Workflow Templates（多角色/并行）在本项目内孵化：完全隔离方案（想法草案）

## 目标

- 在 **不破坏现有默认链路**（manager + executor）的前提下，在同一仓库内孵化 “多流程模板”。
- 支持 **灵活的模板**：例如 `manager + N*critics + N*executors`，且由 manager 动态决定并行度/任务拆分策略。
- 默认行为保持不变：不开启新模板就等价于当前实现。

## 隔离原则（保证“完全隔离”）

- **Feature flag 驱动**：新模板只通过 `run.optionsJson` 开关启用，例如：
  - `workflowTemplate: "m_n_critics_n_execs"`
  - `workflowVersion: 2`
  - `maxParallel: 4`（仅作为上限，实际并行由 manager 决定）
- **代码隔离**：新增实现放到 `src/workflows/`（或同级目录）下，`orchestrator` 只做分发：
  - 默认走现有 `manager+executor` 工作流
  - 命中新模板才进入 `workflow_v2` 路径
- **UI 隔离**：默认 UI 不展示新模板入口；仅当 run 的 options 命中模板时才显示额外信息（初期可直接落到 Events）。
- **测试隔离**：新增 e2e（例如 `m5:workflow:e2e`）不影响现有 `m2/m3/m4`；默认测试仍只验证旧链路。

## 推荐的“灵活架构”最小落地（不改 DB 的第一步）

> 核心思路：把 “多角色、多步流程” 先抽象成 **Steps/Tasks**，落地输出走 `events`（事件流），避免立刻重构 DB 的 turns 表结构。

- **Run 内部引入 step 概念（逻辑层）**：
  - `step.kind`: `manager_plan | exec_task | critic_review | manager_merge | ...`
  - 每个 step 运行一次 provider（或一次工具调用），把结果写入 `events` + artifacts。
- **任务并行策略**：
  - “可并行”的优先是 **只读类**（critics 分析、executor 产出 patch proposal/诊断等）。
  - “会写盘”的 executor 默认仍保持 **单写者**（避免同 workspace 并发写导致冲突）；并行写需要后续引入 worktree/隔离工作区。
- **manager 决定并行数目**：
  - manager 在每轮输出一个结构化计划（JSON）描述要派发的任务队列与依赖（DAG/列表即可），例如：
    - `parallelism: 3`
    - `tasks: [{id, assignee, goal, inputs, constraints}]`
  - orchestrator 根据 `parallelism` 和系统上限（`maxParallel`）调度执行。

## 后续演进（需要更大改动时）

- **真正的多执行者并发写**：每个 executor 用独立 worktree/临时拷贝工作区，最后由 manager 选择合并策略（merge/cherry-pick/patch apply）。
- **通用存储模型**：当 step 成为一等公民时，再考虑新增 `turn_steps`/`run_roles` 表（或重构 turns），把多角色输出结构化入库，UI 可按 role/step 渲染为多 tab。

## 一句话结论

在本项目内孵化完全可行；先用 “feature flag + workflows 模块 + events 记录 step 输出” 做到 **零破坏、可插拔**，再逐步把并行与多角色从“逻辑层”升级为“存储/界面一等公民”。

