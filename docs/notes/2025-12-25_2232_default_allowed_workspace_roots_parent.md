# 默认允许的工作区根目录改为上一级目录

## 需求

当前未设置 `ALLOWED_WORKSPACE_ROOTS` 时，默认只允许 `auto_codex` 仓库目录本身作为 workspace root；在 `E:\sjt\others\auto_codex` 的使用方式下，这会阻碍把 `E:\sjt\others\` 下的其它项目直接注册为 workspace。

目标：默认允许根目录改为 `auto_codex` 的上一级（即 `others`），并保持可通过环境变量/CLI 参数覆盖。

## 变更

- `src/config.js`：未设置 `ALLOWED_WORKSPACE_ROOTS` 时默认值从 `process.cwd()` 改为 `path.resolve(process.cwd(), '..')`。
- `scripts/up.js`：未传 `--allowed-roots` 且未设置 env 时默认值从 `projectRoot` 改为 `path.resolve(projectRoot, '..')`。

## 验证

通过快速启动输出确认 `ALLOWED_WORKSPACE_ROOTS` 默认打印为上一级目录即可（后续 deep 测试会覆盖整体回归）。

