/**
 * Platform ⇄ Chatbot 共享状态桥接层
 * ================================================================
 * 背景
 * ----------------------------------------------------------------
 * Platform（原生 JS）与 Chatbot（React，iframe）之间目前靠裸 postMessage
 * 通信。同一条 agentflow-project-context 会被多个 hook 各自监听：
 *
 *   useChat.js               → selectRef.current(id)
 *   useLocalConversations.js → selectLocal(null)
 *   useExecutionMachines.js  → 监听 environments-changed
 *   App.jsx                  → 监听 mention-issue
 *
 * 每个 hook 自己维护一份 ref 做去重（globalProject.current、
 * hostProjectRef.current）。任何一处漏掉或顺序出错，界面就会停在旧项目上
 * ——这是「改了项目，对话里没跟上」的直接原因。
 *
 * 这一层的目标
 * ----------------------------------------------------------------
 * 把「谁在什么时刻知道哪个项目」收敛成一个可订阅的状态源：
 *
 *   1. 单一真相源：state 只有一份，由 Platform 写入、Chatbot 只读。
 *   2. 写入幂等：重复写入同一个值不触发回调，不需要各 hook 自己比对。
 *   3. 迟到者立即可读：Chatbot 挂载晚于首次写入时，subscribe 会立刻
 *      以当前值回调一次，不必依赖「ready 之后再补发」的时序。
 *   4. 消息类型集中定义：不再各处硬编码字符串，改名只需改一处。
 *
 * 设计取舍
 * ----------------------------------------------------------------
 * - 不引入任何依赖，两侧共用同一份源码（Platform 用 <script> 引入，
 *   Chatbot 用 import）。构建产物由 frontend/build.mjs 生成两份格式。
 * - 状态刻意保持扁平且可 JSON 序列化：postMessage 只传值，不传函数。
 * - 不接管业务逻辑。它只回答「当前项目是哪个」，不替调用方决定
 *   切项目时该清空哪些东西——那属于各 hook 自己的职责。
 */

/** 消息类型。改动这里即同时影响两侧，避免字符串漂移。 */
export const MESSAGE = {
  /** Platform → Chatbot：项目上下文变化 */
  PROJECT_CONTEXT: 'agentflow-project-context',
  /** Platform → Chatbot：执行环境 / 沙箱列表变化 */
  ENVIRONMENTS_CHANGED: 'agentflow-environments-changed',
  /** Platform → Chatbot：请求把某条需求作为 @ 引用插入 */
  MENTION_ISSUE: 'agentflow-chat-mention-issue',
  /** Chatbot → Platform：Chatbot 已就绪 */
  CHAT_READY: 'agentflow-chat-ready',
  /** Chatbot → Platform：会话切换，父窗口同步地址栏 */
  CHAT_SESSION: 'agentflow-chat-session',
  /** Chatbot → Platform：请求父窗口切到某个视图 */
  CHAT_OPEN_VIEW: 'agentflow-chat-open-view',
  /** Chatbot → Platform：项目列表变化，需刷新 */
  PROJECTS_CHANGED: 'agentflow-projects-changed',
  /** Chatbot → Platform：凭据变化 */
  CREDENTIALS_CHANGED: 'agentflow-credentials-changed',
};

/** 共享状态的初始值。字段都必须是可序列化的基本类型。 */
export function initialState() {
  return {
    /** 当前项目 ID。空字符串表示未选择项目。 */
    projectId: '',
    /** 执行环境 / 沙箱变更序号。单调递增，仅用于通知「有变化」。 */
    environmentsRevision: 0,
    /** Chatbot 是否已就绪。Platform 可据此决定是否补发初始状态。 */
    chatReady: false,
  };
}

/**
 * 创建状态仓库。
 *
 * 不直接暴露可变对象，只暴露 get / set / subscribe，保证写入路径唯一。
 * 返回的对象在两侧行为一致：Platform 主要调用 set，Chatbot 主要调用
 * subscribe。
 */
export function createStore(initial = initialState()) {
  let state = { ...initial };
  const listeners = new Set();

  /** 只在值真正变化时通知，且一次 set 合并成一次通知。 */
  function set(patch) {
    const next = { ...state };
    let changed = false;
    for (const key of Object.keys(patch)) {
      if (next[key] !== patch[key]) {
        next[key] = patch[key];
        changed = true;
      }
    }
    if (!changed) return state;
    state = next;
    // 复制一份再遍历：回调里可能再次 subscribe / unsubscribe。
    for (const fn of [...listeners]) {
      try {
        fn(state, patch);
      } catch (err) {
        // 单个订阅者抛错不应影响其他订阅者，也不能中断消息处理。
        console.error('[bridge] subscriber failed', err);
      }
    }
    return state;
  }

  function get() {
    return state;
  }

  /**
   * 订阅状态变化。
   * immediate 为 true 时立即以当前值回调一次，解决「订阅晚于首次写入」。
   */
  function subscribe(fn, { immediate = true } = {}) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    if (immediate) {
      try {
        fn(state, null);
      } catch (err) {
        console.error('[bridge] subscriber failed', err);
      }
    }
    return () => listeners.delete(fn);
  }

  return { get, set, subscribe };
}

export default { MESSAGE, initialState, createStore };
