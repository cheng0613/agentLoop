# frontend/ — Platform ⇄ Chatbot 桥接层

解决「改了项目，对话里没跟上」的问题。

## 先看效果

```bash
# 直接用浏览器打开，无需构建、无需服务
start frontend/prototype.html        # Windows
open  frontend/prototype.html        # macOS
xdg-open frontend/prototype.html     # Linux
```

原型是**自包含单文件**，含三个标签页：

| 标签页 | 内容 |
|---|---|
| **交互演示** | 左右两个面板模拟 Platform 与 Chatbot，可实时切换项目看同步 |
| **原问题** | 原实现为什么不同步：一份状态四个副本 + 时序丢失 |
| **对比** | 改前 / 改后代码对照 |

演示用的是**真实 iframe**，`postMessage` 与同源校验与生产一致。

## 目录

```
frontend/
├── bridge/
│   ├── state.js     状态容器：单一真相源 + 幂等写入 + 立即订阅
│   ├── channel.js   消息通道：来源校验集中、目标窗口延迟绑定
│   └── index.js     两侧装配：createPlatformBridge / createChatbotBridge
├── prototype.html   自包含演示（单文件，可直接打开）
└── README.md
```

## 问题诊断

原实现里，一条 `agentflow-project-context` 被**四个独立监听器**分别处理：

```
useChat.js               → selectRef.current(id)      去重: globalProject.current
useLocalConversations.js → selectLocal(null)          去重: hostProjectRef.current
useExecutionMachines.js  → 监听 environments-changed
App.jsx                  → 监听 mention-issue
```

**同一份状态有四个副本**。任一处没跟上、或执行顺序不对，界面就停在旧项目上。

更隐蔽的是**时序问题**：Chatbot 的 iframe 初始为 `src="about:blank"`，
React 挂载晚于 Platform 的首次广播，消息直接丢失。现有兜底是「收到
chat-ready 后补发」，但补发逻辑分散在 `app.js` 多处，容易漏。

## 桥接层怎么解决

### 1. 单一真相源

状态只有一份，Platform 写、Chatbot 读：

```js
// Platform
platform.setProject('agentflow');

// Chatbot
bridge.subscribeProject((projectId, previous) => {
  // projectId 永远是当前值，不是「这一条消息里的值」
});
```

### 2. 幂等写入

`store.set()` 内部比对，值没变就不通知。各 hook 不再需要自己维护 ref：

```js
// 原实现：每个 hook 都要写
if (projectId === ref.current) return;
ref.current = projectId;

// 桥接层：不需要了
```

### 3. 迟到者能拿到当前值

订阅默认 `immediate: true`，挂载晚也能立刻读到当前项目：

```js
// 即使 Platform 在 iframe 挂载前就广播过，这里仍会收到当前值
const off = bridge.subscribeProject(handler);
```

时序问题从根上消失，不再依赖「chat-ready 后补发」这种兜底。

### 4. 来源校验集中一处

原有代码每个监听器都要重复写：

```js
if (event.origin !== location.origin || event.source !== expected) return;
```

漏写一处就是安全隐患。桥接层在 `channel.js` 里统一处理，且两侧的
「合法来源」语义不同（Platform 只信任自己的 iframe，Chatbot 只信任
`window.parent`），已在代码里分别处理。

## 这一层不做什么

**不接管业务逻辑。** 切项目时该清空草稿、该重新拉会话、该保留哪些缓存，
仍由各 hook 自己决定。

它只回答一个问题：**当前项目是哪个**。

## 接入方式（后续）

### Platform 侧

```html
<script type="module" src="/bridge/index.js"></script>
```

```js
const platform = createPlatformBridge({
  target: () => document.getElementById('chatNextFrame').contentWindow,
});

// 项目选择器变化时
projectSwitcher.addEventListener('change', (e) => {
  platform.setProject(e.target.value);
});
```

替换现有的四处 `postMessage` 调用（`web/app.js:1358 / 1482 / 1483 / 1491`）。

### Chatbot 侧

```jsx
import { createChatbotBridge } from '../../frontend/bridge/index.js';

const bridge = useMemo(() => createChatbotBridge(), []);

useEffect(() => bridge.dispose, [bridge]);

// 替换 useLocalConversations / useChat 里的监听器
useEffect(() => {
  return bridge.subscribeProject((projectId, previous) => {
    selectLocal(null);
  });
}, [bridge]);
```

## 迁移建议

**先只迁移 `projectId` 这一条链路**（影响最大、问题最明显），
验证稳定后再迁移 `environments` 与 `mention-issue`。

理由：`projectId` 是当前不同步的直接来源，而 `environments` 的
逻辑相对独立，可以后做。

## 与 Electron 的关系

这层桥接对 Electron 无副作用。Electron 里加载
`http://127.0.0.1:<port>` 时，iframe 与 postMessage 行为与浏览器一致。
