import React from "react";

import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./home.css";
import "./navigation.css";
import "../../web/app/hover-ink.css";
import "../../web/app/hover-ink.js";
import "./hui-tokens.css";
import "../../web/app/hui-controls.css";
import "../../web/app/hui-tooltip.js";
import "./navigation-motion.css";
import "./composer-context.css";
import "../../web/app/sliding-tabs.css";

// 侧栏视觉对比开关：宿主用 ?ds=flat 打开平铺式，通过 postMessage 通知这里。
// iframe 的 URL 不继承宿主的 query，所以不能自己读 URL；而且宿主的 load
// 事件可能早于这段脚本执行，所以挂载后主动向宿主索要一次当前模式。
// 选定方案后，这段与 navigation.css 里的 ds-flat-sidebar 规则一起删掉。
function applySidebarMode(mode) {
  document.body.classList.toggle("ds-flat-sidebar", mode === "flat");
}
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.data?.type === "agentloop-ds-sidebar") applySidebarMode(event.data.mode);
});
if (window.parent !== window) {
  window.parent.postMessage({ type: "agentloop-ds-sidebar-request" }, location.origin);
}
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h1>工作台暂时无法打开</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <Boundary>
    <App />
  </Boundary>,
);
