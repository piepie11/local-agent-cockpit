# 上手教程（第一次使用）

[中文](TUTORIAL.zh-CN.md) | [English](TUTORIAL.md)

这份文档提供一个从 0 开始的实践流程，帮助你把 `local-agent-cockpit` 安全地跑在电脑和手机上。

## 0) 安装

- Node.js `>= 22`

## 1) 启动服务

1) 安装依赖：

`npm install`

2) 创建 `.env.local`（推荐；已 gitignore）：

- 从 `.env.example` 复制为 `.env.local`
- 至少配置：
  - `ADMIN_TOKEN`（写接口 / Ask / 隐藏文件访问所需）
  - `ALLOWED_WORKSPACE_ROOTS`（限制允许注册 workspace 的根目录）

示例：

- Windows：`ALLOWED_WORKSPACE_ROOTS=C:\projects;D:\work`
- Linux/macOS：`ALLOWED_WORKSPACE_ROOTS=/home/me/projects,/mnt/work`

3) 运行：

- 开发模式：`npm run dev`
- 一键启动（自动找端口）：`npm run up`（或 `up.cmd` / `./up.sh`）

4) 打开：

- 电脑：`http://127.0.0.1:18787/`
- 手机（同局域网 / VPN / Tailscale）：`http://<你的IP>:18787/`

## 2) 安全检查（正式使用前先做）

- 不要把服务直接暴露到公网。
- 一定要设置 `ADMIN_TOKEN`（不要依赖自动生成 token）。
- `ALLOWED_WORKSPACE_ROOTS` 尽量小（不要用 `C:\` 这类大根目录）。

更多内容见：`SECURITY.md`。

## 3) 注册 workspace

进入 **Settings → Workspaces** 新建 workspace：

- `rootPath`：你要编排的项目目录
- `planPath`：
  - 留空 → 默认 `<rootPath>/plan.md`
  - 相对路径 → 相对 `rootPath` 解析（例如 `docs/plan.md`）
  - 绝对路径 → 直接使用该绝对路径
- `conventionPath`：
  - 留空 → 默认 `<rootPath>/约定.md`
  - 规则与 `planPath` 相同

快速体验：

- 直接把 `examples/minimal-workspace/` 注册为 workspace。

## 4) 跑一遍 Manager <-> Executor（安全演示）

1) 打开 **Dashboard**
2) 创建 sessions：
   - provider：`fake`（安全、确定性强）
   - sandbox：`read-only`
3) 创建 run 并点 `Start`（或使用 `Step` 模式）。
4) 打开 **History** 回放整个 run。

说明：运行产物会写入 `data/`（SQLite）和 `runs/`（导出/日志），这些目录默认 gitignore。

## 5) 使用 Ask（随口问）

1) 打开 **Ask**
2) 新建 thread 并发送消息
3) 可选：把多条命令加入队列并自动执行
4) 用另一个设备打开同一 workspace 的 Ask 页面，可看到 SSE 实时更新（无需轮询）

## 6) 使用 Files（浏览 / 预览 / 编辑）

- 未设置 `ADMIN_TOKEN`：
  - 只能浏览非隐藏文件
  - 只读（不能保存）
- 设置了 `ADMIN_TOKEN`：
  - 可浏览隐藏文件（dotfiles）
  - 可编辑并保存文本/Markdown
  - 可预览图片

## 7) 可选：微信推送（PushPlus）

如果你想在 run 完成/step 完成/Ask 回复时收到推送：

1) 把 PushPlus token 写进 `.env.local`：
   - `PUSHPLUS_TOKEN=...`
2) 重启服务。

更多选项见 `.env.example` 和 `docs/CONFIGURATION.zh-CN.md`。
