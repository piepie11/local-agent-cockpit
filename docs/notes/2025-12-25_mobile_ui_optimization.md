# 移动端 UI 优化 & 视觉美化

日期: 2025-12-25

## 修改文件

- `web/styles.css`
- `web/index.html`

## 修改内容

### 1. 修复页面溢出问题
- `html, body` 添加 `overflow-x: hidden; max-width: 100vw`
- `.container`, `.card` 添加 `max-width: 100%; overflow-x: hidden`
- `.input--sm` 的 `min-width` 从 140px 改为 80px

### 2. topbar 优化
- 添加 `flex-wrap: wrap` 允许换行
- 添加 `z-index: 100` 确保置顶
- token 标签在小屏隐藏，输入框宽度缩小 (120px)
- 600px 以上恢复标签显示

### 3. tabs 优化
- 从 5 列 grid 改为 flex 横向滚动
- 添加 `overflow-x: auto` 支持滑动
- 按钮添加 `min-height: 44px` 保证点击区域

### 4. 视觉美化
- 新增 CSS 变量：`--accent`, `--danger`, `--success`
- 主按钮改为绿色 (#238636)，更醒目
- 按钮添加 hover/active 过渡动画
- 新增 `.btn--accent` 蓝色按钮样式
- `.btn--ghost` 添加 hover 背景效果
- 导航和 tabs 按钮添加 hover 效果和过渡动画
- 激活状态改用 accent 颜色高亮
- 输入框 focus 时边框变为 accent 颜色
- 列表项添加 hover 和选中状态样式

### 5. 移动端响应式 (max-width: 599px)
- nav 改为 2 列布局
- row 内 select/input/input--sm 全宽显示
- field 和 check 改为自适应宽度
- pre 区域高度限制 30vh，字体缩小
- kv 标签列宽度缩小
- h2/h3 字体缩小

### 6. HTML 修改
- `stepRunBtn` 改为 `btn--accent` 样式（蓝色）

## 未修改

- HTML 的 id 保持不变
- i18n 结构保持不变
- app.js 逻辑无需修改

## 验证
- `node -e "const fs=require('fs');fs.readFileSync('web/index.html','utf8');fs.readFileSync('web/styles.css','utf8');console.log('web assets: read OK');"`
- `npm run m2:api:e2e`（PASS）

## 结果
- 移动端可用性提升：更少横向溢出、操作控件更容易点中、tabs 支持横向滚动。

## 下一步
- 若要进一步美化：建议在不改动 `id` / `data-i18n*` 的前提下，统一组件（按钮/卡片/列表/表单）的间距、层级与配色规范。
