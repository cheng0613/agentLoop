// rail 展开态内容渲染的验证：伙伴头像取色与行结构、置顶空态、项目清单高亮。
// 用项目现有的 fake DOM 载入 app/rail-nav.js，只断言它生成的 DOM 结构。
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { createDOM } = require('./hui_fake_dom.js');

const source = fs.readFileSync(require('path').join(__dirname, 'app/rail-nav.js'), 'utf8');

function mount(html) {
  const dom = createDOM();
  const { window, document } = dom;
  document.body.innerHTML = html;
  const loc = { href: 'http://localhost/', search: '', hash: '', origin: 'http://localhost' };
  const ctx = {
    document,
    window,
    $: selector => document.querySelector(selector),
    $$: selector => [...document.querySelectorAll(selector)],
    history: {
      back() {},
      forward() {},
      length: 1,
      state: null,
      pushState(state, _title, url) { if (url) loc.href = String(url); },
      replaceState(state, _title, url) { if (url) loc.href = String(url); },
      addEventListener() {},
    },
    localStorage: (() => {
      const store = new Map();
      return {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
      };
    })(),
    state: {
      data: { agents: [], projects: [], sessions: [] },
      currentUser: { id: 'u1' },
      projectFilter: '',
    },
    escapeHTML: value =>
      String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch])),
    lfT: (zh) => zh,
    switchView: () => {},
    mountNativeChat: () => {},
    nativeChatReady: true,
    openAgentWizard: () => {},
    setPlatformRailExpanded: () => {},
    location: loc,
    URLSearchParams,
    URL,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, document, window, run };
}

const shell = `
  <button id="railCollapseBtn"></button>
  <button id="railBackBtn"></button>
  <button id="railForwardBtn"></button>
  <button id="railSearchBtn"></button>
  <button id="railMoreBtn"></button>
  <div id="railMoreMenu" hidden></div>
  <button id="railProjectsToggle" aria-expanded="true"></button>
  <div id="railPartners"></div>
  <section id="railPinnedSection" hidden><div id="railPinned"></div></section>
  <div id="railProjects"></div>
  <div id="railSessionMenu" role="menu" hidden></div>
  <iframe id="chatNextFrame" data-src="native"></iframe>
`;

// 1. 伙伴：一排头像，字母取首字（中文）与前两位（拉丁），摘要进 title。
{
  const { ctx, document } = mount(shell);
  ctx.state.data.agents = [
    { id: 'a1', name: '卡皮巴拉', description: '角色定位 作为前端' },
    { id: 'a2', name: 'Osica', description: '多租户是个影响全' },
  ];
  ctx.renderRailPartners();
  const buttons = document.querySelectorAll('#railPartners .rail-partner');
  assert.strictEqual(buttons.length, 2, '两个角色应渲染两个头像');
  const first = buttons[0].querySelector('.rail-avatar');
  assert.strictEqual(first.textContent, '卡', '中文名取首字');
  assert.ok(first.getAttribute('style').includes('background:#'), '头像要有背景色');
  const second = buttons[1].querySelector('.rail-avatar');
  assert.strictEqual(second.textContent, 'OS', '拉丁名取前两字母并大写');
  assert.ok(buttons[0].getAttribute('title').includes('角色定位'), '摘要进 title');
  console.log('ok 伙伴渲染');
}

// 1b. 伙伴超出上限时折成「+N」，点它进角色页。
{
  const { ctx, document } = mount(shell);
  ctx.state.data.agents = Array.from({ length: 7 }, (_, i) => ({ id: 'a' + i, name: '角色' + i }));
  let wentTo = '';
  ctx.switchView = view => { wentTo = view; };
  ctx.renderRailPartners();
  const avatars = document.querySelectorAll('#railPartners [data-rail-partner]');
  assert.strictEqual(avatars.length, 4, '最多显示 4 个头像');
  const more = document.querySelector('#railPartners [data-rail-partners-more]');
  assert.ok(more, '剩下的角色折成 +N');
  assert.strictEqual(more.textContent, '+3', '7 个角色显示 4 个，剩 3 个');
  more.onclick();
  assert.strictEqual(wentTo, 'agents', '+N 点开进角色页');
  console.log('ok 伙伴 +N');
}

// 1c. 角色数不超过上限时没有「+N」。
{
  const { ctx, document } = mount(shell);
  ctx.state.data.agents = Array.from({ length: 4 }, (_, i) => ({ id: 'a' + i, name: '角色' + i }));
  ctx.renderRailPartners();
  assert.strictEqual(document.querySelectorAll('#railPartners [data-rail-partner]').length, 4);
  assert.strictEqual(document.querySelector('#railPartners [data-rail-partners-more]'), null, '刚好 4 个不出现 +N');
  console.log('ok 伙伴无 +N');
}

// 2. 伙伴空态。
{
  const { ctx, document } = mount(shell);
  ctx.state.data.agents = [];
  ctx.renderRailPartners();
  assert.ok(document.querySelector('#railPartners .rail-empty'), '没有角色时显示空态');
  console.log('ok 伙伴空态');
}

// 3. 置顶：没有置顶时整段隐藏。
{
  const { ctx, document } = mount(shell);
  ctx.renderRailPinned();
  assert.strictEqual(document.getElementById('railPinnedSection').hidden, true, '无置顶时隐藏整段');
  console.log('ok 置顶空态');
}

// 4. 置顶：有置顶时显示行，运行中带绿点。
{
  const { ctx, document } = mount(shell);
  ctx.localStorage.setItem('agentflow.native-chat.pins.u1', JSON.stringify(['s1', 's2']));
  ctx.state.data.sessions = [
    { id: 's1', title: 'loop', runStatus: 'running' },
    { id: 's2', title: 'Cadence', runStatus: 'succeeded' },
  ];
  ctx.renderRailPinned();
  assert.strictEqual(document.getElementById('railPinnedSection').hidden, false, '有置顶时显示整段');
  const rows = document.querySelectorAll('#railPinned .rail-row');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].querySelector('.rail-dot') !== null, true, '运行中的置顶带绿点');
  assert.strictEqual(rows[1].querySelector('.rail-dot'), null, '已完成的置顶不带绿点');
  console.log('ok 置顶渲染');
}

// 5. 全部任务：项目行，当前项目 aria-current，归档项目不列。
{
  const { ctx, document } = mount(shell);
  ctx.state.data.projects = [
    { id: 'p1', name: 'kb-project' },
    { id: 'p2', name: 'rakko-agent' },
    { id: 'p3', name: 'archived', archived: true },
  ];
  ctx.state.projectFilter = 'p2';
  ctx.renderRailProjects();
  const rows = document.querySelectorAll('#railProjects .rail-project-row');
  assert.strictEqual(rows.length, 2, '归档项目不列出');
  assert.strictEqual(rows[1].getAttribute('aria-current'), 'true', '当前项目高亮');
  assert.strictEqual(rows[0].getAttribute('aria-current'), 'false');
  console.log('ok 全部任务渲染');
}

// 5b. 展开项目后列出该项目的会话，点击切到那条会话。
{
  const { ctx, document, run } = mount(shell);
  ctx.state.data.projects = [{ id: 'p1', name: 'kb-project' }];
  ctx.state.data.sessions = [];
  run(`railSessions = ${JSON.stringify([
    { id: 's1', projectId: 'p1', title: '对话', updatedAt: '2026-01-02T00:00:00Z' },
    { id: 's2', projectId: 'p1', title: 'Cadence', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 's3', projectId: 'p2', title: '别家的', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 's4', projectId: 'p1', title: '已归档', archived: true },
  ])};railSessionsLoaded = true;`);
  ctx.renderRailProjects();
  assert.strictEqual(document.querySelectorAll('#railProjects [data-rail-session]').length, 0, '默认收起时不列会话');

  ctx.rememberRailProjectOpen('p1', true);
  ctx.renderRailProjects();
  const sessions = document.querySelectorAll('#railProjects [data-rail-session]');
  assert.strictEqual(sessions.length, 2, '只列该项目未归档的会话');
  assert.strictEqual(sessions[0].textContent.trim(), '对话', '按更新时间倒序');
  assert.strictEqual(sessions[0].getAttribute('data-rail-session'), 's1');
  console.log('ok 全部任务展开到会话');
}

// 5c. 运行中的会话在列表里带绿点。
{
  const { ctx, document, run } = mount(shell);
  ctx.state.data.projects = [{ id: 'p1', name: 'kb-project' }];
  run(`railSessions = ${JSON.stringify([
    { id: 'busy', projectId: 'p1', title: '正在跑', runStatus: 'running', updatedAt: '2026-01-02T00:00:00Z' },
    { id: 'done', projectId: 'p1', title: '跑完了', runStatus: 'succeeded', updatedAt: '2026-01-01T00:00:00Z' },
  ])};railSessionsLoaded = true;`);
  ctx.rememberRailProjectOpen('p1', true);
  ctx.renderRailProjects();
  const rows = document.querySelectorAll('#railProjects [data-rail-session]');
  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].querySelector('.rail-dot'), '运行中的会话带绿点');
  assert.strictEqual(rows[1].querySelector('.rail-dot'), null, '已完成的会话不带绿点');
  console.log('ok 会话运行状态');
}

// 5d. 会话右键菜单：展开/收起，且聊天未就绪时不发送动作。
{
  const { ctx, document, run } = mount(shell);
  const menu = document.getElementById('railSessionMenu');
  menu.hidden = true;
  // fake DOM 不实现布局，菜单定位只需要一个可读的矩形。
  menu.getBoundingClientRect = () => ({ width: 168, height: 140, left: 0, top: 0 });

  ctx.openRailSessionMenu({ dataset: {} }, 's1', 40, 40);
  assert.strictEqual(menu.hidden, false, '右键后菜单展开');
  assert.strictEqual(run('railSessionMenuTarget'), 's1', '记住右键的会话');

  // 聊天 iframe 还没就绪：动作不能假装发出去。
  assert.strictEqual(typeof ctx.postRailSessionAction, 'function');
  ctx.postRailSessionAction('rename');

  ctx.closeRailSessionMenu();
  assert.strictEqual(menu.hidden, true, '关闭后菜单收起');
  assert.strictEqual(run('railSessionMenuTarget'), '', '关闭后清空目标');
}

// 5e. 点会话不整页跳转：整页刷新会把 rail 的内存数据（会话列表）清空。
{
  const { ctx, document } = mount(shell);
  const posted = [];
  const frame = document.getElementById('chatNextFrame');
  frame.contentWindow = { postMessage: (msg) => posted.push(msg) };
  document.body.classList.add('platform-rail-expanded');
  ctx.state.data.projects = [{ id: 'p1', name: 'kb-project' }];
  const beforeHref = ctx.location.href.split('?')[0];

  let remounted = 0;
  ctx.mountNativeChat = () => { remounted++; };
  // 模拟聊天还没有就绪：此时必须按新 URL 重建一次。
  ctx.nativeChatReady = false;

  ctx.openRailSession('s1');

  // 不在工作台 + 聊天未就绪：首次进入要重建一次，但不整页跳转。
  assert.strictEqual(ctx.location.href.split('?')[0], beforeHref, '不应该整页跳转');
  assert.strictEqual(remounted, 1, '首次进入按新 URL 重建一次 iframe');
  assert.strictEqual(posted.length, 0, '重建路径不额外发消息');
  console.log('ok 点会话不整页跳转');
}

// 5f. 已经在工作台时切会话：不改 hash、不调 switchView。
// hash 一变，applyRoute 就会重挂 iframe —— 这就是之前「闪一下」的来源。
{
  const { ctx, document, run } = mount(shell);
  const posted = [];
  const frame = document.getElementById('chatNextFrame');
  frame.contentWindow = { postMessage: (msg) => posted.push(msg) };
  document.body.classList.add('chat-next-active');
  // nativeChatReady 来自 app.js；测试上下文自己给一份，和 rail-nav 读的是同一个全局。
  ctx.nativeChatReady = true;

  let switched = 0;
  ctx.switchView = () => { switched++; };
  const hashBefore = ctx.location.hash;

  ctx.openRailSession('s2');

  assert.strictEqual(switched, 0, '工作台内切会话不该调 switchView');
  assert.strictEqual(ctx.location.hash, hashBefore, '不该改写 hash');
  assert.strictEqual(posted.length, 1);
  assert.strictEqual(posted[0].type, 'agentflow-chat-open-session');
  assert.strictEqual(posted[0].sessionId, 's2');
  console.log('ok 工作台内切会话不闪');
}

// 5g. 新建：开空白会话，清掉会话/任务/项目上下文，且不重建 iframe。
{
  const { ctx, document } = mount(shell);
  const posted = [];
  const frame = document.getElementById('chatNextFrame');
  frame.contentWindow = { postMessage: (msg) => posted.push(msg) };
  document.body.classList.add('chat-next-active');
  ctx.nativeChatReady = true;

  // 假装当前正处在一个带项目、带任务的会话里。
  ctx.location.search = '?projectId=p1&chatSession=s1&chatIssue=i1';
  ctx.location.href = 'http://localhost/?projectId=p1&chatSession=s1&chatIssue=i1#/collaboration/s1';

  let remounted = 0;
  ctx.mountNativeChat = () => { remounted++; };

  ctx.openRailNewChat();

  const after = new URL(ctx.location.href);
  for (const key of ['projectId', 'chatSession', 'chatIssue']) {
    assert.strictEqual(after.searchParams.has(key), false, '新建后不应带 ' + key);
  }
  assert.strictEqual(after.hash, '#/collaboration', '回到干净的工作台地址');
  assert.strictEqual(remounted, 0, '聊天已就绪时不重建 iframe');
  assert.strictEqual(posted.length, 1);
  assert.strictEqual(posted[0].type, 'agentflow-chat-new');
  console.log('ok 新建空白会话');
}

// 6. 折叠：aria-expanded=false 时列表 hidden。
{
  const { ctx, document } = mount(shell);
  ctx.state.data.projects = [{ id: 'p1', name: 'kb-project' }];
  ctx.renderRailProjects();
  ctx.setRailProjectsOpen(false);
  assert.strictEqual(document.getElementById('railProjects').hidden, true, '收起后列表隐藏');
  ctx.setRailProjectsOpen(true);
  assert.strictEqual(document.getElementById('railProjects').hidden, false, '展开后列表显示');
  console.log('ok 全部任务折叠');
}

console.log('\nrail-nav 全部通过');
