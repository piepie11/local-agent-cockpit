const fs = require('fs');

let content = fs.readFileSync('plan.md', 'utf-8');

// 清理所有 contentReference 标记
content = content.replace(/:?contentReference\[oaicite:\d+\]\{index=\d+\}/g, '');

// 修复常见损坏的中文
const fixes = [
  ['Manager ?Executor', 'Manager 与 Executor'],
  ['支?Codex', '支持 Codex'],
  ['（plan.md?', '（plan.md）'],
  ['舒服用?Web', '舒服用的 Web'],
  ['交替执?plan', '交替执行 plan'],
  ['特别强调?', '特别强调：'],
  ['日志?Web', '日志在 Web'],
  ['会话**?', '会话**。'],
  ['CLI?', 'CLI。'],
  ['先读?', '先读）'],
  ['窗口?', '窗口"'],
  ['日?+', '日志 +'],
  ['CLI ?', 'CLI 的'],
  ['非交互模?', '非交互模式'],
  ['流?partial', '流式 partial'],
  ['验证）?', '验证）。'],
  ['权限?', '权限。'],
  ['持久化?', '持久化。'],
  ['（可?', '（可'],
  ['?contentReference', ''],
  [/\?+/g, (match, offset, str) => {
    // 只替换孤立的问号（前后不是中文）
    if (match.length > 1) return '';
    return match;
  }],
];

for (const [from, to] of fixes) {
  if (typeof from === 'string') {
    content = content.split(from).join(to);
  }
}

fs.writeFileSync('plan.md', content, 'utf-8');
console.log('Fixed plan.md, size:', content.length);
