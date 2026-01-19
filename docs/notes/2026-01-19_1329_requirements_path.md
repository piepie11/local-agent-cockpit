# requirementsPath DB/CRUD

做了什么
- workspaces 表新增 requirementsPath 列（schema + 迁移）。
- 迁移为缺失/空值 workspace 填充默认 requirementsPath：rootPath/需求.md。
- CRUD 读写包含 requirementsPath 字段。

怎么验证
- npm test

结果
- npm test: pass

下一步
- 等待下一步指令
