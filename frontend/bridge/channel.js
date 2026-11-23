/**
 * Platform ⇄ Chatbot 消息通道
 * ================================================================
 * 把裸 postMessage 封成「带类型的收发通道」，两侧用同一个接口：
 *
 *   const link = createChannel({ role: 'platform', target: () => iframe.contentWindow });
 *   link.send(MESSAGE.PROJECT_CONTEXT, { projectId: 'p1' });
 *   const off = link.on(MESSAGE.CHAT_READY, () => { ... });
 *
 * 相比直接写 postMessage 的好处：
 *   - 来源校验集中一处。现有代码每个监听器都要重复写
 *     `event.origin !== location.origin || event.source !== expected`，
 *     漏写就成了安全隐患。
 *   - 目标窗口延迟绑定。iframe 的 contentWindow 在挂载前是 null，
 *     Platform 现在要散落很多 `frame?.contentWindow?.postMessage`。
 *   - 消息类型来自 MESSAGE 常量，两侧不会漂移。
 */

import { MESSAGE } from './state.js';

/**
 * @param {object} options
 * @param {'platform'|'chatbot'} options.role 当前所在的一侧
 * @param {() => Window|null} options.target  对端窗口。Chatbot 侧固定为
 *   window.parent；Platform 侧通常是 iframe.contentWindow，可能尚未就绪。
 * @param {() => boolean} [options.isTrusted] 额外校验开关，默认 true。
 * @returns {{ send, on, ready, dispose }}
 */
export function createChannel({ role, target, isTrusted }) {
  const local = new Set();
  let disposed = false;

  /** 对端是否可发消息。Platform 侧 iframe 未挂载时返回 null。 */
  function peerWindow() {
    if (disposed) return null;
    try {
      const win = typeof target === 'function' ? target() : target;
      return win || null;
    } catch {
      // 跨源访问 contentWindow 可能抛错，视为未就绪。
      return null;
    }
  }

  /**
   * 发送一条消息。
   * 返回 true 表示已投递，false 表示对端尚未就绪（调用方可以稍后重试，
   * 或用 subscribe + immediate 让后挂载的一方主动拉取）。
   */
  function send(type, payload) {
    const win = peerWindow();
    if (!win) return false;
    try {
      win.postMessage({ type, ...payload }, location.origin);
      return true;
    } catch (err) {
      console.error('[bridge] postMessage failed', type, err);
      return false;
    }
  }

  /** 监听某类消息。返回取消函数。 */
  function on(type, handler) {
    if (typeof handler !== 'function') return () => {};
    const entry = { type, handler };
    local.add(entry);
    return () => local.delete(entry);
  }

  /**
   * 收到的消息是否可信。
   *
   * 两侧的合法来源不同：
   *   Platform 只信任来自自己 iframe 的消息；
   *   Chatbot 只信任来自 window.parent 的消息。
   * 两者都要求同源。
   */
  function trusted(event) {
    if (disposed) return false;
    if (event.origin !== location.origin) return false;
    const expected = role === 'platform' ? peerWindow() : window.parent;
    if (!expected || event.source !== expected) return false;
    if (typeof isTrusted === 'function' && !isTrusted(event)) return false;
    return true;
  }

  function listener(event) {
    if (!trusted(event)) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;
    for (const entry of [...local]) {
      if (entry.type !== data.type) continue;
      try {
        entry.handler(data, event);
      } catch (err) {
        console.error('[bridge] handler failed', data.type, err);
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', listener);
  }

  /** 对端是否可通信。Platform 可用于判断 iframe 是否已挂载。 */
  function ready() {
    return peerWindow() !== null;
  }

  function dispose() {
    disposed = true;
    local.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', listener);
    }
  }

  return { send, on, ready, dispose, MESSAGE };
}
