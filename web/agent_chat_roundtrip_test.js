// 阶段 3 的端到端契约测试：角色页 -> 协作页 的 URL 往返。
//
// 两个函数分处两侧，只通过 URL 约定耦合：
//   startAgentChat   在 web/app/agents.js（父窗口），负责构造跳转 URL
//   readRoleMention  在 chatbot/src/App.jsx（iframe），负责解析回角色 ID
//
// 任何一侧改名或改参数都会静默失效（点按钮没反应，或绑定了错误的角色），
// 所以把两侧真实源码放进同一个 vm 做往返验证。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const bundle = fs.readFileSync(process.argv[2], 'utf8');
const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'chatbot', 'src', 'App.jsx'),
  'utf8',
);

// 从一段源码里切出某个顶层函数。边界取到下一个顶层声明或注释块为止。
function slice(source, name) {
  const pattern = new RegExp(String.raw`^(?:async )?function ` + name + String.raw`\(`, 'm');
  const match = pattern.exec(source);
  assert(match, name + ' is missing');
  const tail = source.slice(match.index);
  const next = /\n(?:async )?function |\n(?:let|const|export|function) [A-Za-z]|\n\/\/ /.exec(
    tail.slice(1),
  );
  return next ? tail.slice(0, next.index + 1) : tail;
}

const readRoleMentionSource = slice(appSource, 'readRoleMention');
const startAgentChatSource = slice(bundle, 'startAgentChat');

// 跑一次 startAgentChat，再把结果 URL 的 query 交给 readRoleMention 解析。
function roundTrip({ projectFilter, agentId }) {
  const writer = vm.createContext({
    state: { projectFilter },
    URLSearchParams,
    encodeURIComponent,
    location: { href: '' },
  });
  vm.runInContext(startAgentChatSource, writer);
  writer.startAgentChat(agentId);
  if (!writer.location.href) return { href: '', parsed: null };

  const url = new URL(writer.location.href, 'https://example.test');
  const reader = vm.createContext({ URLSearchParams, location: { search: url.search } });
  vm.runInContext(readRoleMentionSource, reader);
  return { href: writer.location.href, url, parsed: reader.readRoleMention() };
}

// 1. 有项目上下文：两侧必须对上
{
  const { href, url, parsed } = roundTrip({ projectFilter: 'agentloop', agentId: 'review' });
  assert(parsed, 'readRoleMention must parse the generated URL: ' + href);
  assert.equal(parsed.roleId, 'review', href);
  assert.equal(parsed.projectId, 'agentloop', href);
  assert.ok(href.endsWith('#/collaboration'), 'must land on collaboration: ' + href);
  assert.ok(url.search.indexOf('mentionRole') >= 0, href);
}

// 2. 无项目上下文：roleId 照常解析，projectId 为空串
{
  const { parsed } = roundTrip({ projectFilter: '', agentId: 'design' });
  assert.equal(parsed.roleId, 'design');
  assert.equal(parsed.projectId, '');
}

// 3. projectFilter 为 undefined 时不能把 "undefined" 拼进 URL
{
  const { href, parsed } = roundTrip({ projectFilter: undefined, agentId: 'build' });
  assert.ok(!href.includes('undefined'), 'must not leak undefined: ' + href);
  assert.equal(parsed.roleId, 'build');
}

// 4. 特殊字符经编码后必须原样还原，不能破坏 URL 结构
{
  const weird = 'role with space/and&slash';
  const { href, parsed } = roundTrip({ projectFilter: 'p&x=1', agentId: weird });
  assert.equal(parsed.roleId, weird, href);
  assert.equal(parsed.projectId, 'p&x=1', href);
}

// 5. 空 agentId 不跳转，也不误判
{
  const { href, parsed } = roundTrip({ projectFilter: 'p', agentId: '' });
  assert.equal(href, '');
  assert.equal(parsed, null);
}

console.log('role chat round trip ok');
