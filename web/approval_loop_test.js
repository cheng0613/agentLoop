// 阶段 4 的审批闭环测试：产物内联、卡片锚点、批准后跳转。
//
// 覆盖三个容易静默失效的点：
//   1. approvalArtifactsHTML 的排序与截断（产物按节点顺序，最多 8 个）
//   2. 审批卡带 data-run-card，产物点击才能找到对应 run
//   3. approveRun / rejectRun 处理后要调用 focusNextApproval
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const bundle = fs.readFileSync(process.argv[2], 'utf8');

function slice(name) {
  const pattern = new RegExp(String.raw`^(?:async )?function ` + name + String.raw`\(`, 'm');
  const match = pattern.exec(bundle);
  assert(match, name + ' is missing from the app bundle');
  const tail = bundle.slice(match.index);
  const next = /\n(?:async )?function |\n(?:let|const) [A-Za-z]|\n\/\/ /.exec(tail.slice(1));
  return next ? tail.slice(0, next.index + 1) : tail;
}

function escapeHTML(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function runArtifacts(run) {
  const context = vm.createContext({ escapeHTML });
  vm.runInContext(slice('approvalArtifactsHTML'), context);
  return context.approvalArtifactsHTML(run);
}

// 1. 没有产物时不渲染空区块
assert.equal(runArtifacts({ artifacts: [] }), '');
assert.equal(runArtifacts({}), '');
assert.equal(runArtifacts(null), '');

// 2. 产物按工作流节点顺序排列，而不是数组顺序
{
  const run = {
    workflowSnapshot: { nodes: [{ id: 'design' }, { id: 'implement' }] },
    artifacts: [
      { id: 'a2', nodeId: 'implement', name: 'implementation.md', size: 2048, attempt: 1 },
      { id: 'a1', nodeId: 'design', name: 'design.md', size: 1024, attempt: 1 },
    ],
  };
  const html = runArtifacts(run);
  assert.ok(html.indexOf('design.md') < html.indexOf('implementation.md'), 'artifacts must follow node order');
  assert.match(html, /data-artifact="a1"/);
  assert.match(html, /data-artifact="a2"/);
  assert.match(html, /本轮产物/, 'section label');
}

// 3. 超过 8 个时截断，并提示还有多少
{
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: 'n' + i }));
  const artifacts = nodes.map((n, i) => ({
    id: 'a' + i,
    nodeId: n.id,
    name: 'file' + i + '.md',
    size: 1024,
    attempt: 1,
  }));
  const html = runArtifacts({ workflowSnapshot: { nodes }, artifacts });
  const cards = (html.match(/class="ap-artifact"/g) || []).length;
  assert.equal(cards, 8, 'must cap at 8 artifacts, got ' + cards);
  assert.match(html, /还有 4 个/, 'must tell how many are hidden');
}

// 4. 多次尝试要在卡片上标注，返工记录可见
{
  const run = {
    workflowSnapshot: { nodes: [{ id: 'impl' }] },
    artifacts: [{ id: 'a', nodeId: 'impl', name: 'review.md', size: 512, attempt: 2 }],
  };
  const html = runArtifacts(run);
  assert.match(html, /第 2 次/, 'retry attempt must be visible: ' + html);
}

// 5. 审批卡必须带 data-run-card，产物点击才能反查 run
assert.match(
  bundle,
  /class="ap-card[^"]*"\s+data-run-card="\$\{escapeHTML\(r\.id\)\}"/,
  'approval card must carry data-run-card',
);

// 6. 批准与退回都要把视线带到下一条
for (const fn of ['approveRun', 'rejectRun']) {
  const body = slice(fn);
  assert.match(body, /focusNextApproval\(/, fn + ' must advance to the next approval');
}

console.log('approval loop ok');
