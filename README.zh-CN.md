# local-agent-cockpit

[中文](README.zh-CN.md) | [English](README.md)

一个“手机可用”的本地 Web 控制台，用来编排 **Manager <-> Executor** 的回合制协作（底层调用你本机的 CLI Agent：Codex CLI / Claude Code CLI）。

## 功能

- Dashboard：创建会话/运行；支持 `Start` / `Step` / `Pause` / `Stop` / `Inject`
- Ask（随口问）：按 workspace 的对话 + 队列；SSE 跨设备实时同步（无轮询）
- Files：浏览工作区文件；预览图片；编辑并保存文本/Markdown
- History：回放每一轮；导出 `.md` / `.json` / `.jsonl`
- 通知（可选）：通过 PushPlus 推送到微信

## 快速开始

### 环境要求

- Node.js `>= 22`（使用 `node:sqlite`；运行时会有 experimental 提示，属已知现象）

### 运行

1) 安装依赖

`npm install`

2) 创建 `.env.local`（推荐）

- 从 `.env.example` 复制为 `.env.local`（该文件已被 gitignore，不会被提交）
- 至少配置：
  - `ADMIN_TOKEN`（写接口必需）
  - `ALLOWED_WORKSPACE_ROOTS`（限制允许注册 workspace 的目录范围）

示例（Windows）：

`ALLOWED_WORKSPACE_ROOTS=C:\projects;D:\work`

3) 启动服务

- 开发模式：`npm run dev`
- 一键启动（自动找端口）：`npm run up`（或 `up.cmd` / `./up.sh`）

4) 打开页面

- 电脑：`http://127.0.0.1:18787/`
- 手机（同局域网 / VPN / Tailscale）：`http://<你的IP>:18787/`

## 安全（务必阅读）

本项目可以在你的机器上读写文件并运行命令，务必注意：

- 一定要设置 `ADMIN_TOKEN`，并严格保密
- 一定要限制 `ALLOWED_WORKSPACE_ROOTS`
- 不要把服务直接暴露到公网（建议 LAN/VPN/ACL/HTTPS 反代）

详见 [`SECURITY.md`](SECURITY.md)。

## 文档

- [`docs/README.zh-CN.md`](docs/README.zh-CN.md)：文档索引（中文）
- [`docs/TUTORIAL.zh-CN.md`](docs/TUTORIAL.zh-CN.md)：上手教程（中文）
- [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md)：项目全景报告（架构 + 文件结构 + 读代码导航，中文）
- [`docs/CONFIGURATION.zh-CN.md`](docs/CONFIGURATION.zh-CN.md)：配置说明（中文）
- [`docs/DEVELOPMENT.zh-CN.md`](docs/DEVELOPMENT.zh-CN.md)：开发与测试（中文）

## 示例 workspace

- [`examples/minimal-workspace/`](examples/minimal-workspace/)：一个最小可用的示例 workspace（含 `plan.md` + `约定.md`），可直接注册用于跑通流程。

## 测试

- `npm test`：运行核心 e2e（不依赖 Codex/Claude CLI）
- 可选（需要本机安装并登录对应 CLI）：
  - `npm run m0:smoke`
  - `npm run m0:roundtrip`
  - `npm run m1:e2e:codex`
  - `npm run m1:e2e:claude`

## License

MIT，见 [`LICENSE`](LICENSE)。
