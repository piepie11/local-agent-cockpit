# Files：后端 workspace 文件系统 API（只读+写入）

目标：
- 提供“文件浏览器”所需的目录浏览、文本预览、图片/文件下载能力
- `ADMIN_TOKEN` 控制能力边界：无 token 只能浏览非隐藏文件 + 只读；有 token 可浏览隐藏文件并允许写入
- 强化安全：防路径穿越、阻止 symlink 指向 workspace 外部

## 权限约定

- 无 token：
  - 可 `list/read/blob`（仅非隐藏路径，隐藏文件/目录直接 403）
  - `readOnly=true`（前端应禁用保存）
- 有 token：
  - 可浏览隐藏文件/目录
  - 可 `PUT` 写入文本文件（仍受 `READ_ONLY_MODE` 限制）

## API

- `GET /api/workspaces/:id/fs/list?path=...&limit=...`
  - 列出目录内容（默认 root）
  - 返回：`items[{name, relPath, kind(dir/file/symlink/other)}]` + `truncated`
- `GET /api/workspaces/:id/fs/text?path=...`
  - 读取 UTF-8 文本（大文件截断，二进制拒绝）
  - 返回：`content, truncated, sizeBytes, mtimeMs`
- `PUT /api/workspaces/:id/fs/text`（需要 `ADMIN_TOKEN`）
  - body：`{ path, content, baseMtimeMs }`
  - 支持乐观锁：`baseMtimeMs` 不匹配 → 409 `FILE_CHANGED`
  - 二进制文件拒绝写入：400 `FILE_NOT_TEXT`
- `GET /api/workspaces/:id/fs/blob?path=...`
  - 以流方式返回文件
  - 仅对安全的图片扩展名设置 `inline`，其余强制 `attachment`，避免浏览器执行 HTML 等内容

## 安全实现点

- 只允许相对路径：拒绝绝对路径、盘符前缀、UNC 路径等
- 路径需在 workspace 内：`resolve + realpath + isInside` 双重校验，阻止 symlink 逃逸
- “隐藏路径”判断：任意 path segment 以 `.` 开头即视为隐藏

