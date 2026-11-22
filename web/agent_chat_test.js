// startAgentChat 的 URL 构造测试。
//
// startAgentChat 把角色页的点击转成一次跳转，由 chatbot 侧解析 mentionRole。
// 这个函数只依赖全局 state.projectFilter 和 location，所以可以用 vm 注入桩后单独跑。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const bundle = fs.readFileSync(process.argv[2], 'utf8');

function source(name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(bundle);
  assert(match, name + ' missing from the app bundle');
  const tail = bundle.slice(match.index);
  const next = /\n(?:async )?function |\n(?:let|const) [A-Za-z]|\n\/\/ /.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

// 每个用例拿一份干净的 vm 上下文：startAgentChat 会写 location.href。
function run({ projectFilter, agentId = 'review' }) {
  const context = vm.createContext({
    state: { projectFilter },
    URLSearchParams,
    encodeURIComponent,
    location: { href: '' },
  });
  vm.runInContext(source('startAgentChat'), context);
  context.startAgentChat(agentId);
  return context.location.href;
}

// 1. 有项目上下文：projectId 必须在 query 里，且包在 #/collaboration 之前
{
  const href = run({ projectFilter: 'agentloop' });
  assert.match(href, /^\/\?/, 'root path with query');
  assert.match(href, /projectId=agentloop/);
  assert.match(href, /mentionRole=review/);
  assert.ok(
    href.indexOf('mentionRole') < href.indexOf('#'),
    'query must precede the hash fragment: ' + href,
  );
  assert.ok(href.endsWith('#/collaboration'), 'hash must target collaboration: ' + href);
}

// 2. 没有项目上下文：仍然要能跳转，只是不带 projectId
{
  const href = run({ projectFilter: '' });
  assert.ok(!href.includes('projectId'), 'no projectId when project is unset: ' + href);
  assert.match(href, /mentionRole=review/);
  assert.ok(href.endsWith('#/collaboration'), href);
}

// 3. projectFilter 缺失（undefined）时不能拼出 "undefined"
{
  const href = run({ projectFilter: undefined });
  assert.ok(!href.includes('undefined'), 'must not leak undefined: ' + href);
  assert.match(href, /mentionRole=review/);
}

// 4. 特殊字符要编码，避免破坏 URL
{
  const href = run({ projectFilter: 'pro ject&x=1', agentId: 'role/with space' });
  assert.ok(!href.includes('pro ject&x=1'), 'projectId must be encoded: ' + href);
  assert.ok(!href.includes('role/with space'), 'agentId must be encoded: ' + href);
  assert.match(href, /mentionRole=role%2Fwith%20space/);
}

// 5. 空 agentId 不跳转
{
  const href = run({ projectFilter: 'agentloop', agentId: '' });
  assert.equal(href, '', 'empty agent id must not navigate');
}

console.log('startAgentChat ok');
