# M2 workspace create modal

做了什么
- 顶栏“新增 workspace”改为打开创建弹窗（桌面 modal / 移动端 bottom sheet）
- 复用创建逻辑：抽出单一 createWorkspace 入口，Settings 表单与 modal 共用
- modal 内展示 /api/health 的 allowedWorkspaceRoots，并提供可读错误与 PATH_NOT_ALLOWED 说明

如何手动验证
1) 点击顶栏“新增 workspace”打开弹窗，确认 modal 显示
2) 观察 allowed roots 列表与说明提示
3) 不填 ADMIN_TOKEN 直接提交，应在弹窗内提示需要 ADMIN_TOKEN
4) 填 ADMIN_TOKEN + 合规 rootPath，创建成功并自动选中新 workspace
5) 使用不在允许列表内的 rootPath 提交，弹窗内显示 ROOT_PATH_NOT_ALLOWED

验证结果
- npm test：通过
- npm run m2:api:e2e：通过（有 ExperimentalWarning: SQLite）
- 手动验收（headless Chrome + CDP）：
  {"modalVisible":true,"allowedHasRoot":true,"tokenErrorHas":true,"modalHiddenAfterCreate":true,"selectedOk":true,"rootMatches":true,"badErrorHas":true}

已知限制/下一步
- 无
