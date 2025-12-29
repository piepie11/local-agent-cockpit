# GitHub 推送：PAT + Windows 代理（Socks）导致 GCM 登录失败的处理

## 背景现象

在 Windows 上使用 HTTPS 推送到 GitHub 时，Git Credential Manager（GCM）可能会尝试走“浏览器登录/设备码登录”流程，然后出现类似报错：

- `info: please complete authentication in your browser...`
- `fatal: ServicePointManager 不支持...代理`（常见于系统/环境变量配置了 SOCKS5 代理）

这类情况下，浏览器登录流程会失败或反复提示，但 **手动输入 Username + PAT** 通常仍然可用。

## 关键结论（安全 + 可自动化）

- 不要把 GitHub PAT 写进项目代码、`.env`、脚本或仓库文件里。
- 推荐让 Git 通过 **Credential Manager（Windows 凭据管理器）** 存储 PAT。
- 为了让自动化（或非交互环境）也能 `git push`，需要让凭据已保存并可自动读取：
  - 用 `GIT_TERMINAL_PROMPT=0` 跑一次 `git push`，能成功（或显示 `Everything up-to-date`）就说明没问题。

## 解决步骤（CMD 版本，最常用）

### 1) 先禁用代理（本次会话）

```bat
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
```

### 2) 使用 PAT 推送（并绕过代理配置）

```bat
git -c credential.helper= -c http.proxy= -c https.proxy= push -u origin main
```

出现提示时：

- `Username for 'https://github.com':` 输入你的 GitHub 用户名（例如 `piepie11`）
- `Password for 'https://piepie11@github.com':` 粘贴 **GitHub PAT**（不是账号密码）

> 备注：用 `-c credential.helper=` 是为了绕开 GCM 的浏览器登录流程（它可能被 SOCKS 代理搞崩）。

### 3) 验证“已可非交互推送”

```bat
set GIT_TERMINAL_PROMPT=0
git push
```

预期输出：`Everything up-to-date`（或直接完成 push），且 **不会再提示输入用户名/密码**。

## PAT 权限要点（你遇到的 workflow 拒绝）

如果提交里包含 `.github/workflows/*.yml`（GitHub Actions 工作流），GitHub 会要求 PAT 具有 workflow 权限，否则会拒绝推送：

- 报错示例：`refusing to allow a Personal Access Token to create or update workflow ... without workflow scope`

对应处理：

- **Fine-grained PAT**：对目标仓库授予 `Contents: Read and write` + `Workflows: Read and write`
- **Classic PAT**：至少勾选 `repo`，并额外勾选 `workflow`

## 推荐的长期方案（更稳）

如果经常被代理/弹窗登录困扰，建议改用 SSH：

- 给 GitHub 配 SSH key
- 把 remote 改为 `git@github.com:<owner>/<repo>.git`

SSH 方式通常比 HTTPS+GCM 更不受代理环境影响，也不需要在终端里粘贴 PAT。

