// 展开态左侧导航的内容渲染。
//
// rail 收起时是 56px 图标栏（index.html 里的 rail-nav / rail-bottom），展开后
// 变成 304px 的完整导航：顶栏、五个入口、伙伴、置顶、全部任务。这个文件只负责
// 展开态才出现的三块动态内容——伙伴、置顶、全部任务；入口和顶栏是静态 HTML，
// 由 app.js 的既有 switchView 处理。
//
// 伙伴取项目的角色定义（/api/agents，state.data.agents），着色字母头像由名字
// 生成，不依赖后端头像字段。置顶沿用协作页约定的 localStorage 键。全部任务
// 列出项目（/api/bootstrap 的 projects），点开切到该项目的工作台。

const RAIL_AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#ca8a04'];

// 和 httpapi 的 initialsAvatar 同一套取色与取字规则，保证同一个名字在任何
// 地方都是同一个颜色的头像。
function railAvatar(name) {
  const text = String(name || '').trim();
  const key = text || '?';
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const color = RAIL_AVATAR_COLORS[(hash >>> 0) % RAIL_AVATAR_COLORS.length];
  // 中文取首字，拉丁取前两个字母（Osica → Os）以便分辨。
  const initial = /[\u3400-\u9fff]/.test(key) ? key.slice(0, 1) : key.slice(0, 2);
  return { color, initial: initial.toUpperCase() };
}

// 置顶是协作页侧栏写下的同一份列表；rail 只读不写，避免两处各自维护。
function railPinnedIds() {
  const userId = state.currentUser?.id;
  if (!userId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(`agentflow.native-chat.pins.${userId}`) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function railSetEmpty(host, text) {
  host.innerHTML = `<p class="rail-empty">${escapeHTML(text)}</p>`;
}

// 伙伴：项目里可用的角色，横向排一行头像；放不下的折成「+N」，点开进角色页。
const RAIL_PARTNER_VISIBLE = 4;

function renderRailPartners() {
  const host = $('#railPartners');
  if (!host) return;
  const agents = (state.data?.agents || []).slice(0, 12);
  if (!agents.length) {
    railSetEmpty(host, lfT('当前项目还没有角色', 'No roles in this project yet'));
    return;
  }
  const shown = agents.slice(0, RAIL_PARTNER_VISIBLE);
  const rest = agents.length - shown.length;
  const items = shown.map(agent => {
    const avatar = railAvatar(agent.name);
    const summary = String(agent.description || '').trim().split('\n')[0];
    const title = `${agent.name}${summary ? ' · ' + summary : ''}`;
    return `<button type="button" class="rail-partner" data-rail-partner="${escapeHTML(agent.id)}" title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}">
      <span class="rail-avatar" style="background:${avatar.color}" aria-hidden="true">${escapeHTML(avatar.initial)}</span>
    </button>`;
  }).join('');
  const more = rest > 0
    ? `<button type="button" class="rail-partner rail-partner-more" data-rail-partners-more title="${escapeHTML(lfT(`还有 ${rest} 个角色`, `${rest} more roles`))}" aria-label="${escapeHTML(lfT(`还有 ${rest} 个角色`, `${rest} more roles`))}">+${rest}</button>`
    : '';
  host.innerHTML = items + more;
  host.querySelectorAll('[data-rail-partner]').forEach(button => {
    button.onclick = () => {
      const id = button.dataset.railPartner;
      const agent = (state.data?.agents || []).find(item => item.id === id);
      if (agent && typeof openAgentWizard === 'function') {
        switchView('agents');
        openAgentWizard(agent);
        return;
      }
      switchView('agents');
    };
  });
  const moreButton = host.querySelector('[data-rail-partners-more]');
  if (moreButton) moreButton.onclick = () => switchView('agents');
}

// 置顶：协作页置顶过的会话。运行中的会话带绿点，和后端 runStatus 对齐。
function renderRailPinned() {
  const section = $('#railPinnedSection');
  const host = $('#railPinned');
  if (!section || !host) return;
  const ids = railPinnedIds();
  if (!ids.length) {
    section.hidden = true;
    host.innerHTML = '';
    return;
  }
  const known = new Map((state.data?.sessions || []).map(session => [session.id, session]));
  const running = new Set(['running', 'pending', 'queued', 'waiting']);
  section.hidden = false;
  host.innerHTML = ids.map(id => {
    const session = known.get(id);
    const name = session?.displayTitle || session?.title || id;
    const busy = running.has(String(session?.runStatus || ''));
    return `<button type="button" class="rail-row" data-rail-pin="${escapeHTML(id)}" title="${escapeHTML(name)}">
      <svg class="rail-row-icon agent-icon harness-icon" data-icon="folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      <span class="rail-row-name">${escapeHTML(name)}</span>
      ${busy ? '<span class="rail-dot" role="img" aria-label="' + lfT('正在运行', 'Running') + '"></span>' : ''}
    </button>`;
  }).join('');
  host.querySelectorAll('[data-rail-pin]').forEach(button => {
    button.onclick = () => openRailSession(button.dataset.railPin);
  });
}

// 全部任务：项目清单。点开切到该项目的工作台；当前项目高亮。
// 全部任务：项目可展开，展开后列出该项目的会话。会话与聊天侧栏同源。
let railSessions = [];
let railSessionsLoading = false;
let railSessionsLoaded = false;
const RAIL_EXPANDED_PROJECTS_KEY = 'agentflow.railExpandedProjects';

function railExpandedProjects() {
  try {
    const raw = JSON.parse(localStorage.getItem(RAIL_EXPANDED_PROJECTS_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function rememberRailProjectOpen(projectId, open) {
  const set = railExpandedProjects();
  if (open) set.add(projectId);
  else set.delete(projectId);
  try {
    localStorage.setItem(RAIL_EXPANDED_PROJECTS_KEY, JSON.stringify([...set]));
  } catch {}
}

// 拉会话列表。每次展开项目都重新拉一次：新建/重命名/删除后就地生效，
// 否则列表一直停在上次加载的状态。
async function loadRailSessions() {
  if (railSessionsLoading) return;
  railSessionsLoading = true;
  try {
    const rows = await api('/api/assistant/sessions');
    railSessions = Array.isArray(rows) ? rows : [];
    railSessionsLoaded = true;
  } catch {
    // 读不到会话时保留项目列表。
  } finally {
    railSessionsLoading = false;
    renderRailProjects();
  }
}

function railSessionsForProject(projectId) {
  return railSessions
    .filter(session => (session.projectId || '') === (projectId || ''))
    .filter(session => !session.archived)
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

function renderRailProjects() {
  const host = $('#railProjects');
  if (!host) return;
  const projects = (state.data?.projects || []).filter(project => !project.archived);
  if (!projects.length) {
    railSetEmpty(host, lfT('还没有项目', 'No projects yet'));
    return;
  }
  const open = railExpandedProjects();
  const activeSession = new URL(location.href).searchParams.get('chatSession') || '';
  host.innerHTML = projects.map(project => {
    const isOpen = open.has(project.id);
    const current = project.id === state.projectFilter;
    const sessions = railSessionsForProject(project.id);
    const rows = isOpen
      ? sessions.map(session => {
          const name = session.displayTitle || session.title || session.id;
          const isActive = session.id === activeSession;
          return `<button type="button" class="rail-row rail-row-session" data-rail-session="${escapeHTML(session.id)}" aria-current="${isActive}" title="${escapeHTML(name)}">
            <span class="rail-row-name">${escapeHTML(name)}</span>
            ${['running', 'pending', 'queued', 'waiting'].includes(String(session.runStatus || '')) ? `<span class="rail-dot" role="img" aria-label="${escapeHTML(lfT('正在运行', 'Running'))}"></span>` : ''}
          </button>`;
        }).join('') || `<p class="rail-empty">${escapeHTML(lfT('这个项目还没有对话', 'No conversations yet'))}</p>`
      : '';
    return `<div class="rail-project" data-rail-project-group="${escapeHTML(project.id)}">
      <button type="button" class="rail-row rail-project-row" data-rail-project="${escapeHTML(project.id)}" aria-current="${current}" aria-expanded="${isOpen}" title="${escapeHTML(project.name || project.id)}">
        <svg class="rail-row-icon agent-icon harness-icon" data-icon="folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        <span class="rail-row-name">${escapeHTML(project.name || project.id)}</span>
        <svg class="rail-chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      ${rows ? `<div class="rail-project-sessions">${rows}</div>` : ''}
    </div>`;
  }).join('');

  // 点项目名展开/收起；展开后才拉会话，避免冷启动就请求。
  host.querySelectorAll('[data-rail-project]').forEach(button => {
    button.onclick = () => {
      const id = button.dataset.railProject;
      const willOpen = !railExpandedProjects().has(id);
      rememberRailProjectOpen(id, willOpen);
      if (willOpen) void loadRailSessions();
      renderRailProjects();
    };
  });
  host.querySelectorAll('[data-rail-session]').forEach(button => {
    button.onclick = () => openRailSession(button.dataset.railSession);
    button.oncontextmenu = event => {
      event.preventDefault();
      openRailSessionMenu(button, button.dataset.railSession, event.clientX, event.clientY);
    };
  });
}

// 会话右键菜单：重命名 / 置顶 / 归档 / 删除。
// 这些动作要调会话接口、也要弹确认对话框，都在聊天 iframe 里，
// 所以这里只负责菜单 UI，选中的动作转发过去。
let railSessionMenuTarget = '';

function openRailSessionMenu(anchor, sessionId, x, y) {
  const menu = $('#railSessionMenu');
  if (!menu || !sessionId) return;
  railSessionMenuTarget = sessionId;
  const session = railSessions.find(item => item.id === sessionId) || {};
  const pinned = new Set(railPinnedIds());
  // 置顶/归档按钮的文案跟着当前状态走。
  const pinItem = menu.querySelector('[data-rail-session-act="pin"] .rail-label');
  if (pinItem) pinItem.textContent = pinned.has(sessionId) ? lfT('取消置顶', 'Unpin') : lfT('置顶', 'Pin');
  const archiveItem = menu.querySelector('[data-rail-session-act="archive"] .rail-label');
  if (archiveItem) archiveItem.textContent = session.archived ? lfT('恢复', 'Restore') : lfT('归档', 'Archive');

  menu.hidden = false;
  const rail = $('.platform-rail');
  const railBounds = rail ? rail.getBoundingClientRect() : { right: 0, top: 0 };
  const bounds = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - bounds.width - 8);
  const top = Math.min(y, window.innerHeight - bounds.height - 8);
  menu.style.left = `${Math.max(8, left - railBounds.left)}px`;
  menu.style.top = `${Math.max(8, top - railBounds.top)}px`;
  menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
}

function closeRailSessionMenu() {
  const menu = $('#railSessionMenu');
  if (menu) menu.hidden = true;
  railSessionMenuTarget = '';
}

// 把选中的动作交给聊天 iframe 执行；没就绪就丢弃，不假装成功。
function postRailSessionAction(action) {
  const sessionId = railSessionMenuTarget;
  if (!sessionId || !action) return;
  const frame = $('#chatNextFrame');
  if (!frame || frame.dataset.src !== 'native' || !nativeChatReady) return;
  frame.contentWindow?.postMessage(
    { type: 'agentflow-chat-session-action', sessionId, action },
    location.origin
  );
}

// 打开置顶会话：工作台用 chatSession 参数定位会话，和协作页一致。
// 新建：开一个空白会话，不关联任务、不带项目。
// 先清掉 URL 上的会话/任务/项目上下文，再让聊天自己重置。
// 聊天已就绪时只发消息、不重建 iframe，避免闪一下。
function openRailNewChat() {
  const url = new URL(location.href);
  ['chatSession', 'chatIssue', 'issueId', 'mentionIssue', 'mentionRole', 'projectId'].forEach(key =>
    url.searchParams.delete(key)
  );
  url.hash = '#/collaboration';
  history.replaceState({}, '', url.toString());

  const frame = $('#chatNextFrame');
  const chatReady = frame && frame.dataset.src === 'native' && nativeChatReady;
  // [DIAG] 临时日志：定位「新建无效」。
  console.log('[diag] openRailNewChat', {
    chatReady,
    dataSrc: frame?.dataset.src,
    nativeChatReady,
    hasContentWindow: !!frame?.contentWindow,
  });
  if (chatReady) {
    frame.contentWindow?.postMessage({ type: 'agentflow-chat-new' }, location.origin);
    markActiveRailSession('');
    return;
  }

  console.warn('[diag] openRailNewChat 走了重建分支');
  if (typeof switchView === 'function') switchView('collaboration');
  if (frame) frame.dataset.src = '';
  if (typeof mountNativeChat === 'function') mountNativeChat();
}

// 打开会话：让聊天 iframe 自己切，不重建 iframe、不整页跳转。
// 这里**不能**调 switchView：它内部会 persistView，把 chatSession 写进
// hash（#/collaboration/<id>）；hash 一变，applyRoute 又会重置并重挂
// iframe，于是每切一次会话就闪一次。所以先改 query，再直接把请求递给聊天。
function openRailSession(sessionId) {
  if (!sessionId) return;
  const url = new URL(location.href);
  url.searchParams.set('chatSession', sessionId);
  url.searchParams.delete('chatIssue');
  history.replaceState({}, '', url.toString());

  const frame = $('#chatNextFrame');
  const chatReady = frame && frame.dataset.src === 'native' && nativeChatReady;
  const onWorkbench = document.body.classList.contains('chat-next-active');

  if (chatReady && onWorkbench) {
    frame.contentWindow?.postMessage(
      { type: 'agentflow-chat-open-session', sessionId },
      location.origin
    );
    markActiveRailSession(sessionId);
    return;
  }

  // 不在工作台或聊天还没就绪：先把会话写进 hash 让路由接管，
  // 这是首次进入工作台，闪一下可以接受。
  const hashUrl = new URL(url.toString());
  hashUrl.hash = '#/collaboration/' + encodeURIComponent(sessionId);
  history.replaceState({}, '', hashUrl.toString());
  if (typeof switchView === 'function') switchView('collaboration');
  if (!chatReady) {
    if (frame) frame.dataset.src = '';
    if (typeof mountNativeChat === 'function') mountNativeChat();
  }
  markActiveRailSession(sessionId);
}

// 只挪高亮，不重建列表：重建会丢掉展开状态以外的滚动位置。
function markActiveRailSession(sessionId) {
  const host = $('#railProjects');
  if (!host) return;
  host.querySelectorAll('[data-rail-session]').forEach(button => {
    button.setAttribute('aria-current', String(button.dataset.railSession === sessionId));
  });
}

// 会话搜索弹窗在聊天 iframe 里。切到工作台后把请求递过去；
// iframe 还没挂好时先记下，等它发来 ready 再补发。
let pendingRailSearch = false;

function postPendingRailSearch() {
  if (!pendingRailSearch) return;
  const frame = $('#chatNextFrame');
  if (!frame || frame.dataset.src !== 'native' || !nativeChatReady) return;
  pendingRailSearch = false;
  frame.contentWindow?.postMessage({ type: 'agentflow-chat-search' }, location.origin);
}

function openRailSessionSearch() {
  pendingRailSearch = true;
  switchView('collaboration');
  postPendingRailSearch();
}

function renderRailNav() {
  renderRailPartners();
  renderRailPinned();
  renderRailProjects();
  syncRailProjectsToggle();
  syncRailCollapseButton();
}

function syncRailProjectsToggle() {
  const toggle = $('#railProjectsToggle');
  const list = $('#railProjects');
  if (!toggle || !list) return;
  const open = toggle.getAttribute('aria-expanded') !== 'false';
  list.hidden = !open;
}

// 折叠按钮在展开态叫「收起导航」，收起后叫「展开导航」，是唯一能展开回来的入口。
function syncRailCollapseButton() {
  const button = $('#railCollapseBtn');
  if (!button) return;
  const expanded = document.body.classList.contains('platform-rail-expanded');
  const label = expanded ? lfT('收起导航', 'Collapse navigation') : lfT('展开导航', 'Expand navigation');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', String(expanded));
  button.dataset.railTip = label;
}

function setRailProjectsOpen(open) {
  const toggle = $('#railProjectsToggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(!!open));
  syncRailProjectsToggle();
}

// 顶栏的菜单按钮：和「更多」共用一个菜单，只是触发点不同。
function closeRailMoreMenu() {
  const menu = $('#railMoreMenu');
  const button = $('#railMoreBtn');
  if (menu) menu.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

function toggleRailMoreMenu(anchor) {
  const menu = $('#railMoreMenu');
  if (!menu) return;
  const host = anchor || $('#railMoreBtn');
  const open = menu.hidden;
  if (!open) {
    closeRailMoreMenu();
    return;
  }
  const bounds = host.getBoundingClientRect();
  const rail = $('.platform-rail');
  const railBounds = rail ? rail.getBoundingClientRect() : { right: bounds.right, top: bounds.top };
  // 收起态是 56px 图标栏，菜单要贴着栏右侧展开；展开态则贴在触发点下方。
  if (document.body.classList.contains('platform-rail-expanded')) {
    menu.style.left = '0px';
    menu.style.top = `${Math.round(bounds.bottom - railBounds.top + 4)}px`;
  } else {
    menu.style.left = `${Math.round(railBounds.right + 6)}px`;
    menu.style.top = `${Math.round(bounds.top)}px`;
  }
  menu.hidden = false;
  $('#railMoreBtn')?.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function bindRailNav() {
  renderRailNav();

  // 「新建」不能走通用的 .nav[data-view] 切换：那只会重开当前会话。
  // 这里直接覆盖绑定，开一个不关联任何任务、也不带项目的新会话。
  const newChatBtn = $('[data-rail-new-chat]');
  if (newChatBtn) newChatBtn.onclick = () => openRailNewChat();

  // 折叠按钮是收起之后唯一能把导航展开回来的入口，所以它是 toggle。
  $('#railCollapseBtn')?.addEventListener('click', () => {
    setPlatformRailExpanded(!document.body.classList.contains('platform-rail-expanded'));
    syncRailCollapseButton();
  });
  syncRailCollapseButton();
  $('#railBackBtn')?.addEventListener('click', () => history.back());
  $('#railForwardBtn')?.addEventListener('click', () => history.forward());

  // 搜索：切到工作台并让聊天打开会话搜索弹窗（⌘K 那个）。
  // 聊天在 iframe 里，所以这里和「需求交接」走同一条 postMessage 通道。
  $('#railSearchBtn')?.addEventListener('click', () => openRailSessionSearch());

  $('#railMoreBtn')?.addEventListener('click', event => {
    event.stopPropagation();
    toggleRailMoreMenu(event.currentTarget);
  });
  document.querySelector('[data-rail-menu-toggle]')?.addEventListener('click', event => {
    event.stopPropagation();
    toggleRailMoreMenu(event.currentTarget);
  });
  // 菜单项本身带 data-view，点击由 bind() 里 .nav[data-view] 的统一监听处理；
  // 这里只负责把菜单收起来，避免重复切一次视图。
  $('#railMoreMenu')?.addEventListener('click', event => {
    if (event.target.closest('[data-view]')) closeRailMoreMenu();
  });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.rail-more-wrap, #railMoreMenu')) return;
    closeRailMoreMenu();
  });

  // 会话右键菜单：选一项就执行并收起；点外部或按 Esc 也收起。
  $('#railSessionMenu')?.addEventListener('click', event => {
    const item = event.target.closest('[data-rail-session-act]');
    if (!item) return;
    const action = item.dataset.railSessionAct;
    if (action === 'pin') {
      const sessionId = railSessionMenuTarget;
      postRailSessionAction(new Set(railPinnedIds()).has(sessionId) ? 'unpin' : 'pin');
    } else {
      postRailSessionAction(action);
    }
    closeRailSessionMenu();
  });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('#railSessionMenu')) return;
    closeRailSessionMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeRailMoreMenu();
    closeRailSessionMenu();
  });

  $('#railProjectsToggle')?.addEventListener('click', () => {
    const toggle = $('#railProjectsToggle');
    setRailProjectsOpen(toggle.getAttribute('aria-expanded') === 'false');
  });

  bindRailHistory();
}

// 前进/后退按钮：浏览器不给可读的历史长度（history.length 含其他标签页），
// 所以每次 pushState 往 state 里存一个递增序号，popstate 时和目标序号比较，
// 就知道是后退（当前序号变小）还是前进（变大）。
let railHistorySeq = 0;
let railHistoryAt = 0;

function railPushDepth() {
  railHistorySeq += 1;
  railHistoryAt = railHistorySeq;
  syncRailBackButtons();
}

// 给 persistView 用：先取下一个序号写进 state，随后 pushState 会调 railPushDepth
// 把内部计数推到同一位置。
function railNextSeq() {
  return railHistorySeq + 1;
}

function syncRailBackButtons() {
  const back = $('#railBackBtn');
  const forward = $('#railForwardBtn');
  if (!back || !forward) return;
  back.disabled = railHistoryAt <= 0;
  // 浏览器无法可靠告知「能否前进」，只在后退过一次后才点亮；
  // 前进后会更新 railHistoryAt，回到最新位置时再次变灰。
  forward.disabled = railHistoryAt >= railHistorySeq;
}

function bindRailHistory() {
  window.addEventListener('popstate', event => {
    const target = Number(event.state?.railSeq || 0);
    railHistoryAt = target;
    syncRailBackButtons();
  });
  syncRailBackButtons();
}
