// 角色列表结构测试：确认「会话」按钮已经进了行模板，且表头列数与 grid 对齐。
//
// 不执行 renderAgents（它依赖整页 DOM），而是对源码做静态断言。
// 这样测试稳定，也能在改动模板时立刻发现列数错位。
const fs = require('node:fs');
const assert = require('node:assert/strict');

const bundle = fs.readFileSync(process.argv[2], 'utf8');

// 1. 行模板必须包含会话按钮，并带上角色 ID
assert.match(
  bundle,
  /data-agent-chat="\$\{escapeHTML\(a\.id\)\}"/,
  'agent row template must expose data-agent-chat',
);
assert.match(bundle, /class="agent-chat-btn"/, 'chat button must carry its class');
assert.match(bundle, /agent-row-chat/, 'chat button needs its own grid cell');

// 2. 点击必须接到 startAgentChat
assert.match(
  bundle,
  /\[data-agent-chat\][\s\S]{0,120}startAgentChat\(/,
  'chat button click must call startAgentChat',
);

// 3. 表头列数要和 CSS grid 一致（当前 6 列）
const headMatch = /const head='<div class="agent-row agent-row-head"[^']*'/.exec(bundle);
assert(headMatch, 'agent table head template is missing');
const headColumns = (headMatch[0].match(/<div/g) || []).length - 1; // 去掉最外层
assert.equal(
  headColumns,
  6,
  'head must declare 6 columns to match the grid, got ' + headColumns,
);

// 4. CSS grid 也要是 6 列，否则按钮会错位
const css = fs.readFileSync(require('node:path').join(__dirname, 'product-v4.css'), 'utf8');
const grid = /#agentsView \.agent-row\{[\s\S]*?grid-template-columns:([^;]+);/.exec(css);
assert(grid, 'agent row grid is missing');
const tracks = grid[1].trim().split(/\s+(?![^(]*\))/).filter(Boolean);
assert.equal(
  tracks.length,
  6,
  'CSS grid must have 6 tracks to match the head, got ' + tracks.length + ': ' + grid[1].trim(),
);

// 5. 按钮样式必须存在
assert.match(css, /#agentsView \.agent-chat-btn/, 'chat button style is missing');

console.log('agent chat button structure ok');
