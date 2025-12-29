# local-agent-cockpit
手机可用的 Web 控制台，用来编排 **Manager ↔ Executor** 回合制协作（目前以 **Codex CLI** 为主，Claude 作为后续扩展）。

## 详细文档

- 项目全景报告：`docs/PROJECT_REPORT.md`

## 快速开始（Windows/macOS/Linux）

## 运行要求

- Node.js >= 22（使用 `node:sqlite`；运行时会有 experimental 提示，属已知现象）

## 一键启动（推荐）

- Windows（CMD）：`up.cmd`
- Windows（PowerShell）：`.\up.ps1`
- Linux/macOS：`./up.sh`
- 通用：`npm run up`（支持 `--port/--host/--allowed-roots`）

默认从 `18787` 起寻找空闲端口，并自动读/写 `data/admin_token.txt`（可用 `--no-token-file` 关闭）。

1) 安装依赖
- `npm install`

2) 配置环境变量（推荐）
- 支持使用 `.env.local`（已 gitignore；可从 `.env.example` 复制）
- `ADMIN_TOKEN`：写接口口令（必配，否则会随机生成并打印到控制台）
- `ALLOWED_WORKSPACE_ROOTS`：允许注册 workspace 的根目录白名单（用 `;` 或 `,` 分隔）
  - 例：`ALLOWED_WORKSPACE_ROOTS=E:\sjt\others;E:\projects`
- （可选）微信推送通知（PushPlus）：配置 `PUSHPLUS_TOKEN` 即可启用；细项见 `.env.example`

3) 启动
- `npm run dev`
- 默认监听：`0.0.0.0:18787`（本机访问用 `http://127.0.0.1:18787/`；手机/Tailscale 用 `http://<Tailscale-IP>:18787/`）

4) 手机访问（同一局域网）
- 默认已对外监听；用手机打开：`http://<你的电脑内网IP或Tailscale-IP>:18787/`
- 如需仅本机访问：启动前设置 `HOST=127.0.0.1`

## UI 使用流程（MVP）

1) Settings：查看 health（allowed roots / token source），填入 `ADMIN_TOKEN`（写操作必须）
2) Settings：添加 workspace（rootPath 必须在 `ALLOWED_WORKSPACE_ROOTS` 内）
3) Dashboard：
   - Create default sessions（会创建 codex 的 manager/executor sessions，默认 `mode=stateful_resume`；可在 Sessions 页改为 `stateless_exec`）
   - Create run（可设置 maxTurns/timeout/repoDigest/requireGitClean/noProgressLimit 等）
   - Start / Step / Pause / Stop
   - Inject：给 manager/executor 手动插话纠偏
   - Export：导出 md/json/jsonl
4) History：查看按轮次展开的 prompt/output，并支持关键词过滤（turns search）

## Provider

- `codex`：真实调用 `codex exec --json --output-last-message`（需要本机已安装并登录 Codex CLI）
- `claude`：真实调用 `claude -p --output-format stream-json`（需要本机已安装并登录 Claude Code）
- `fake`：纯本地模拟（用于 e2e 测试）

## 安全提示（强制建议）

- 这是“远程执行本机代码”的控制台：务必设置 `ADMIN_TOKEN`，并通过 `ALLOWED_WORKSPACE_ROOTS` 限制可注册目录。
- 不要把服务直接裸露到公网；优先内网/VPN/反代，并做好 ACL/HTTPS。

## 验证命令

- `npm run m0:smoke`：验证 codex exec 封装可用（需安装 Codex CLI）
- `npm run m0:roundtrip`：最小 Manager→Executor→Manager(Done) 回合验证（需安装 Codex CLI）
- `npm run m1:e2e:fake`：Orchestrator e2e（不依赖 Codex CLI）
- `npm run m1:e2e:codex`：Orchestrator e2e（真实 Codex provider，read-only，无副作用）
- `npm run m1:e2e:claude`：Orchestrator e2e（真实 Claude provider，工具禁用，无副作用）
- `npm run m2:api:e2e`：后端 API 深度 e2e（含 auth/allowlist/并发锁/SSE/导出/保护开关）
- `npm run m2:deep`：全量回归（串行跑完上述核心用例）
- `npm run m6:notify:e2e`：通知 e2e（本地 mock PushPlus，不会真实推送）

## 10 分钟跑通（Checklist）
1) 安装依赖：
pm install
2) 一键启动：up.cmd / .\up.ps1 / ./up.sh（或 
pm run up）
   - 本机访问：http://127.0.0.1:18787/
3) 获取 ADMIN_TOKEN
   - 来源：启动终端输出 或 data/admin_token.txt
   - **不要**写进 README，也不要提交到代码仓库
   - 示例：<YOUR_ADMIN_TOKEN>
4) 打开 UI，填入 token
5) 新建 workspace
   - ootPath：workspace 根目录（必填，必须在 ALLOWED_WORKSPACE_ROOTS 内）
   - planPath / conventionPath：文档路径，可为相对 ootPath（例如 plan.md / 约定.md / docs/plan.md）
6) Dashboard：Load plan → Create default sessions → Start/Step
   - 或打开 **Codex 用户窗口** 发送一条消息（快速验证连通）
7) 常见坑：ALLOWED_WORKSPACE_ROOTS / PATH_NOT_ALLOWED
   - ootPath 必须在允许白名单内；设置 .env.local 的 ALLOWED_WORKSPACE_ROOTS，或用 --allowed-roots 启动参数
   - ootPath 必须是存在的目录；路径不存在或指向文件会直接报错

## 手机访问（LAN / Tailscale）
- 同一局域网：http://<LAN-IP>:18787/（例如 http://192.168.1.20:18787/）
- Tailscale：http://<Tailscale-IP>:18787/（例如 http://100.64.x.y:18787/）
- 安全提醒：**不要**将服务裸露到公网；优先内网 / VPN / 反代，并配置 ACL/HTTPS

## 通知（PushPlus 例子）
- PushPlus 只是通知中转的一种选择，**非广告/非合作**，欢迎替代方案
- 配置方式：设置 PUSHPLUS_TOKEN（示例见 .env.example），必要时开启 PUSH_NOTIFICATIONS_ENABLED=true
- 已知限制：
  - 提醒可能不稳定、延迟或被系统折叠
  - 需要用户近期交互（例如 48 小时窗口）时更容易收到提醒
  - 客服消息策略/条数可能限制频率
- 收不到提醒先检查（FAQ）：
  1) 是否已关注/绑定对应账号
  2) 是否在近期交互窗口内
  3) 手机通知/免打扰是否开启
  4) PUSHPLUS_TOKEN 是否正确
  5) 服务器是否能访问推送服务
  6) 是否被平台限频/限流

