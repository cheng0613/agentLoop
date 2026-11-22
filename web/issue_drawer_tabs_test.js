// 阶段 4 的需求抽屉精简测试。
//
// 抽屉从 9 个 tab 收敛为 3 个（概览 / 执行 / 历史）。风险在于：
//   - 列表页与历史深链仍会带旧 tab id（sop/clarify/acceptance...）
//   - 旧 id 必须落到合并后的 pane，且高亮要跟着走
//   - 表头按钮数量与渲染出的 pane 数量要一致
const fs = require('node:fs');
const assert = require('node:assert/strict');

const bundle = fs.readFileSync(process.argv[2], 'utf8');
const indexHtml = fs.readFileSync(__dirname + '/index.html', 'utf8');

// 1. 抽屉只有 3 个 tab 按钮
const tabsBlock = /<div class="drawer-tabs" id="issueDetailTabs">([\s\S]*?)<\/div>/.exec(indexHtml);
assert(tabsBlock, 'issue drawer tabs are missing');
const tabNames = [...tabsBlock[1].matchAll(/data-dtab="([a-z]+)"/g)].map((m) => m[1]);
assert.deepEqual(
  tabNames,
  ['overview', 'execute', 'history'],
  'drawer must expose exactly 3 tabs, got ' + tabNames.join(','),
);

// 2. 旧 id 到新 tab 的映射必须完整覆盖原来那 9 个 tab
const aliasMatch = /const ISSUE_TAB_ALIAS=\{([^}]+)\}/.exec(bundle);
assert(aliasMatch, 'ISSUE_TAB_ALIAS is missing');
const aliasPairs = [...aliasMatch[1].matchAll(/([a-z]+):'([a-z]+)'/g)].map((m) => [m[1], m[2]]);
const alias = Object.fromEntries(aliasPairs);

const legacyTabs = [
  'conversations',
  'overview',
  'operations',
  'clarify',
  'sop',
  'artifacts',
  'delivery',
  'acceptance',
  'activity',
];
for (const tab of legacyTabs) {
  const mapped = alias[tab] || tab;
  assert(
    ['overview', 'execute', 'history', 'conversations'].includes(mapped),
    'legacy tab ' + tab + ' maps to unknown target: ' + mapped,
  );
}

// 3. 旧 id 的高亮判定要走同一个映射函数
assert.match(bundle, /function issueDetailTabOf\(/, 'issueDetailTabOf helper is missing');
const highlighters = bundle.match(/b\.dataset\.dtab===/g) || [];
assert.ok(highlighters.length >= 2, 'tab highlight logic must exist');
assert.match(
  bundle,
  /b\.dataset\.dtab===issueDetailTabOf\(state\.issueDetailTab\)/,
  'highlight must use the alias helper',
);

// 4. panes 里旧 id 必须仍可渲染（不能返回 undefined 导致「暂无内容」）
const panesBlock = /const panes=\{([\s\S]*?)\};/.exec(bundle);
assert(panesBlock, 'panes map is missing');
for (const tab of legacyTabs) {
  assert.match(
    panesBlock[1],
    new RegExp('\\b' + tab + ':'),
    'panes must still render legacy tab ' + tab,
  );
}

// 5. 历史 tab 把「活动」与「操作日志」合并，两者都要在里面
assert.match(
  bundle,
  /const historyBody=\[[\s\S]*?activityPane[\s\S]*?operationsPane[\s\S]*?\]/,
  'history pane must merge activityPane and operationsPane',
);

console.log('issue drawer tabs ok');
