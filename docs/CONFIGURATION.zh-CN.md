# 配置说明

[中文](CONFIGURATION.zh-CN.md) | [English](CONFIGURATION.md)

`local-agent-cockpit` 通过环境变量读取配置，并支持在启动时自动加载 `.env` 和 `.env.local`。

## 文件约定

- `.env.example`：会提交到 git（只包含安全占位符）
- `.env.local`：推荐用于本地机密配置（已 gitignore）

## 必需项

- `ADMIN_TOKEN`
  - 写接口必需（例如创建/修改 workspace、Ask、保存文件等）。
  - 如果不设置，服务端会随机生成 token，但不建议用于长期使用/对外访问场景。

## Workspace 安全

- `ALLOWED_WORKSPACE_ROOTS`
  - 允许注册 workspace 的根目录白名单（用 `;` 或 `,` 分隔）。
  - 示例（Windows）：`ALLOWED_WORKSPACE_ROOTS=C:\projects;D:\work`
  - 示例（Linux/macOS）：`ALLOWED_WORKSPACE_ROOTS=/home/me/projects,/mnt/work`

如果不设置，默认是“当前工作目录的父目录”（更建议显式配置白名单）。

## 服务端监听

- `HOST`（默认：`0.0.0.0`）
- `PORT`（默认：`18787`）

## 数据与运行产物

- `DB_PATH`（默认：`data/app.sqlite`）
- `RUNS_DIR`（默认：`runs/`）

## 安全开关

- `READ_ONLY_MODE=true`
  - 即使提供了 `ADMIN_TOKEN`，也会拒绝写接口请求。

## 推送通知（可选）

完整选项见 `.env.example`。常用项：

- `PUSHPLUS_TOKEN`
- `PUSH_NOTIFICATIONS_ENABLED=true|false`
- `PUSH_NOTIFY_RUN_FINAL=true|false`
- `PUSH_NOTIFY_RUN_STEP=true|false`
- `PUSH_NOTIFY_ASK_REPLY=true|false`
