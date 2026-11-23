/**
 * 两侧共用的桥接装配
 * ================================================================
 * state.js 给的是纯状态容器，channel.js 给的是纯消息通道。这一层把两者
 * 接起来，形成「Platform 写状态 → 广播 → Chatbot 更新订阅者」的单向流。
 *
 * 为什么需要这一层而不是让 Chatbot 直接听 postMessage
 * ----------------------------------------------------------------
 * 现有实现里 Chatbot 的每个 hook 各自听 agentflow-project-context，各自
 * 维护 ref 去重。问题不是消息没到，而是：
 *
 *   1. 订阅晚于首次广播。Chatbot 的 iframe 懒加载，Platform 在挂载时就
 *      发了初始项目，消息落空，只能靠「chat-ready 之后补发」兜底——
 *      而补发逻辑分散在 app.js 的多个位置，容易漏。
 *   2. 去重状态多份。同一项目被多个 ref 各记一遍，任何一处没跟上就不同步。
 *
 * 这一层保证：
 *   - Chatbot 挂载后立即 subscribe(immediate)，拿到的是「当前值」而不是
 *     「错过的消息」。时序问题从根上消失。
 *   - 去重只在 store 内部做一次，hook 不需要自己比对。
 */

import { MESSAGE, createStore } from './state.js';
import { createChannel } from './channel.js';

/**
 * Platform 侧：持有状态、对外广播。
 *
 * @param {object} options
 * @param {() => Window|null} options.target 返回 iframe 的 contentWindow
 */
export function createPlatformBridge({ target }) {
  const store = createStore();
  const channel = createChannel({ role: 'platform', target });

  /**
   * 写入项目上下文并广播。
   * 重复写入同一项目不会重复广播（store 内部去重），调用方无需判断。
   */
  function setProject(projectId) {
    const value = String(projectId || '');
    store.set({ projectId: value });
    channel.send(MESSAGE.PROJECT_CONTEXT, { projectId: value });
  }

  /** 通知执行环境有变化。用递增序号表达「有变更」。 */
  function markEnvironmentsChanged() {
    const revision = store.get().environmentsRevision + 1;
    store.set({ environmentsRevision: revision });
    channel.send(MESSAGE.ENVIRONMENTS_CHANGED, { revision });
  }

  /** 请求把某条需求作为 @ 引用插入对话。 */
  function mentionIssue(issue) {
    if (!issue) return;
    channel.send(MESSAGE.MENTION_ISSUE, issue);
  }

  /**
   * Chatbot 就绪后补发一次完整状态。
   * 这是双保险：即使 Chatbot 侧的 immediate 订阅已拿到值，补发也能覆盖
   * 「iframe 重载」这类需要重新同步的场景。
   */
  function syncAll() {
    const s = store.get();
    channel.send(MESSAGE.PROJECT_CONTEXT, { projectId: s.projectId });
    if (s.environmentsRevision > 0) {
      channel.send(MESSAGE.ENVIRONMENTS_CHANGED, { revision: s.environmentsRevision });
    }
  }

  channel.on(MESSAGE.CHAT_READY, () => {
    store.set({ chatReady: true });
    syncAll();
  });

  return {
    channel,
    store,
    setProject,
    markEnvironmentsChanged,
    mentionIssue,
    syncAll,
    get projectId() {
      return store.get().projectId;
    },
    dispose: channel.dispose,
  };
}

/**
 * Chatbot 侧：只读状态、订阅变化。
 *
 * 用法：
 *   const bridge = createChatbotBridge();
 *   bridge.subscribeProject((projectId, previous) => { ... });
 *
 * 这里的 immediate 订阅是关键：即便 Platform 在 iframe 挂载前就广播过，
 * 订阅回调仍会拿到当前值。hook 不再需要「ready 之后再补发」的逻辑。
 */
export function createChatbotBridge() {
  const store = createStore();
  const channel = createChannel({ role: 'chatbot', target: () => window.parent });

  channel.on(MESSAGE.PROJECT_CONTEXT, (data) => {
    store.set({ projectId: String(data.projectId || '') });
  });

  channel.on(MESSAGE.ENVIRONMENTS_CHANGED, (data) => {
    const revision = Number(data.revision) || 0;
    store.set({ environmentsRevision: revision });
  });

  /** 订阅项目变化。previous 为 undefined 表示首次同步。 */
  function subscribeProject(handler, options) {
    let previous;
    return store.subscribe((state) => {
      if (state.projectId === previous) return;
      const from = previous;
      previous = state.projectId;
      handler(state.projectId, from);
    }, options);
  }

  /** 订阅执行环境变化。revision 变化即代表需要重新拉取。 */
  function subscribeEnvironments(handler, options) {
    let previous;
    let first = true;
    return store.subscribe((state) => {
      // 首次订阅时若 revision 为 0，说明从未收到过变更，不通知。
      if (first) {
        first = false;
        previous = state.environmentsRevision;
        if (previous === 0) return;
      }
      if (state.environmentsRevision === previous) return;
      previous = state.environmentsRevision;
      handler(state.environmentsRevision);
    }, options);
  }

  /** 告知 Platform 已就绪，触发一次完整状态补发。 */
  function announceReady() {
    channel.send(MESSAGE.CHAT_READY, {});
  }

  /** 请求父窗口切视图。 */
  function openView(view, options = {}) {
    channel.send(MESSAGE.CHAT_OPEN_VIEW, { view, ...options });
  }

  return {
    channel,
    store,
    subscribeProject,
    subscribeEnvironments,
    announceReady,
    openView,
    dispose: channel.dispose,
  };
}
