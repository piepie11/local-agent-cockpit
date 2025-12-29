# M3 workspace edit modal

做了什么
- 复用 workspace modal 增加“编辑”模式，Dashboard 提供编辑入口并通过 PATCH 保存
- 统一 workspace 创建/编辑的 payload 校验与错误展示，失败在 modal 内显示
- 保存后刷新 workspace 列表与选中项，确保 planPath 等配置即时生效

手动验收
1) Dashboard 点击“编辑”，修改 name 并保存：workspace 列表与当前详情同步更新
2) 修改 planPath 为存在文件（plan_alt.md），保存后点击“Load plan”成功加载
3) 修改 planPath 为不存在路径（missing_plan.md），保存后点击“Load plan”提示 PLAN_READ_FAILED

验证结果
- npm test：通过
- npm run m2:api:e2e：通过（有 ExperimentalWarning: SQLite）
- 手动验收（headless Chrome + CDP）：{"nameOk":true,"selectOk":true,"planOk":true,"alertOk":true}

下一步
- 等待下一步指令
