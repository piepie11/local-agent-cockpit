  # test workspace plan

  目标：在本 workspace 内创建一个最小 Node 项目并验证能跑通。

  步骤：
  1. 生成 package.json：scripts 包含
     - start: node src/index.js
     - test: node src/index.js
  2. 创建 src/index.js：打印一行 "hello auto_codex test"
  3. 创建 README.md：1~3 句话说明这是测试项目
  4. 运行 npm test，确保 exit 0，并在 <EXEC_LOG> 里报告

  约束：
  - 只改本 workspace（test/）内文件
  - 不要联网/不要装依赖（不需要 npm install）
  完成条件：
  - 上述文件都存在
  - npm test 通过
  - Manager 输出 Done