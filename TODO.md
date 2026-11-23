# AgentLoop 二次开发 TODO

## 部署与品牌

- [x] **镜像改名 `loopforge-platform:local` → `agentloop-platform:local`**
  - 已改 4 处：`compose.dev.yaml`（image + AGENTFLOW_ISOLATED_IMAGE）、`.env`、`scripts/configure-mirrors.sh`
  - 另改了 `scripts/testdata/install-sudo.Dockerfile` 的默认值
  - 已用 `docker tag` 建别名 → 改配置 → 重建验证 → 删旧 tag
  - 验证：平台容器与沙箱容器都指向 `agentloop-platform:local`，旧 tag 已删除

- [ ] **Pi CLI 按需安装路径修正**（可选）
  - 之前手动安装时装错了位置：代码期望 `<CLI_DIR>/pi/current/node_modules/.bin/pi`，
  - 实际装到了 `pi/node_modules/`。如再需要，正确命令：
    ```bash
    docker exec agentloop-platform-1 sh -c '
      mkdir -p "$AGENTFLOW_RUNTIME_CLI_DIR/pi/current" && \
      cd "$AGENTFLOW_RUNTIME_CLI_DIR/pi/current" && \
      npm install --no-audit --no-fund @earendil-works/pi-coding-agent'
    ```
  - 注：Agent 类 SOP 需要模型凭据（`user_bot_credentials` 表当前为空）

## UI 优化

- [x] 任务看板样式优化
  - 新增顶部统计条（进行中 / 待我确认 / 已完成，数量为 0 不渲染）
  - 「待我确认」独立分组置顶，用强调色标题与描边
  - 卡片显示当前节点名

## IA 重构进度

- [x] 阶段 1 导航重排 — `baf667a`
- [x] 阶段 2 工作台任务看板 — `b237ddd`
- [x] 阶段 3 角色会话 — `5735f55` + 测试 `716d291`
- [x] 阶段 4 审批闭环 + 抽屉精简 — `b96802f`

设计文档：`docs/ia-redesign.md`

## 已验证

- 审批闭环端到端跑通：脚本 SOP 跑到人工验收 → 产物内联渲染正确 →
  批准后 finish 节点自动执行 → 3 个产物全部产出
- 测试数据已清理，数据库恢复到测试前状态

## 待确认

- `startAgentChat` 用 `state.projectFilter` 取当前项目，变量名未验证
  （若跳转后 projectId 不对，需改为实际的全局变量名）

## 平台共享凭据（provider keys）

已完成（分支 `feat/platform-provider-keys`）：
- [x] Phase 1 存储 + API（`platform_provider_keys` 表，3 个端点）
- [x] Phase 2 运行时「个人优先、共享补齐」注入
- [x] Phase 3 平台管理「共享模型凭据」页
- [x] Phase 4 定时任务与引擎列表放开限制
- 支持 7 个 CLI：CodeBuddy / OpenCode / Antigravity / Kimi / Pi / DSH / ZCode

入口位置备忘：设置 → 开放与平台 → 平台管理 → 第 4 个 tab「共享模型凭据」

待办：
- [ ] **提升「平台管理」入口**：目前在设置侧栏最底，三层之下。
      建议放到 rail 一级（仅管理员可见），与管理职责相称。
- [ ] **Codex / Claude Code 接入**：暂不考虑。将来若需要，先补
      `domain.AgentCLIProtocolOptions`（codex→responses，claude-code→messages），
      再把它们加回 `platformProviderKinds`。
- [ ] **沙箱网络验证**：连通性测试从平台容器发起，SOP 沙箱是嵌套容器。
      若测试通但实际运行失败，需单独检查沙箱网络策略。
- [ ] **CodeBuddy 网关化不可行**：它没有 BaseURL 字段，只能连官方三个端点
      （国际站 / 国内站 internal / iOA）。共享机制只能共用同一把 Key，
      无法指向自建网关。需要走网关时改用 OpenCode / Pi / DSH 等。

## Trae 接入调研（结论：不接入执行器）

调研时间：本次会话。结论：**Trae 没有独立的 headless CLI，无法作为执行器接入。**

证据：
- npm 上不存在 `trae` / `trae-cli` 可执行包，只有 `trae`（无关的 HTTP 客户端）。
- 所有 Trae 相关 npm 包清一色是「把 Trae 当模型 provider」的适配器：
  · `@magpie-community/opencode-trae-auth` — OpenCode 的 provider 插件
  · `dsh-connect-trae` — DSH 的模型接入插件
  · `@hex4c59/pi-ext-trae-cn` — Pi 的 provider 扩展
  · `trae-cn-provider` — DSH 的 LLM provider
  · `dsh-trae-api` — 把 Trae 额度转成 OpenAI 兼容 API
- Trae 本体是 AI IDE（字节跳动，trae.cn / trae.ai），类似 Cursor，无 CLI。
  社区做法是逆向其客户端凭证，包成 OpenAI/Anthropic 兼容层。

因此：
- ❌ 不要新增 `AgentCLIExecutorKinds` 条目。平台所有执行器都依赖
  `NewAgentCLITranslator` 解析 headless JSON 输出（agent_cli_stream.go），
  没有 CLI 就没有可解析的流。
- ✅ 若要使用 Trae 的模型，走网关聚合：

| 方式 | 做法 | 工作量 |
|---|---|---|
| A. 网关聚合（推荐） | 统一网关把 Trae 作为 upstream，现有 6 个 CLI 直接可用 | 0（纯运维） |
| B. 单独起转换服务 | 用 `dsh-trae-api` 起本地 OpenAI 兼容服务，平台里配成 OpenCode 的 BaseURL | 0.5 天 |

风险提示：社区包靠复用本机登录的 Trae 凭证工作，团队内部使用可能违反
Trae 服务条款，落地前建议先确认合规。

## 导航视图的两个必改项（踩过的坑）

把一个视图从「设置」提升为 rail 一级入口时，**必须同时改两处**，只改一处会留下视觉问题：

```js
// web/app.js
const settingsManagementViews = [...];  // 决定是否按「设置视图」渲染
const noSidebarViews        = [...];    // 决定是否隐藏侧栏容器
```

| 只改前者 | 后果 |
| --- | --- |
| 不在 settingsManagementViews，也不在 noSidebarViews | 侧栏容器照常渲染但配置导航不显示 → **左侧一块空白** |
| 仍在 settingsManagementViews | 完整设置菜单出现，把页面挤到右侧 |

已处理（2026-11-23）：
- `sops` 流程列表：补进 noSidebarViews（原左侧空白的直接原因）
- `flow` 流程设计：移出 settingsManagementViews，并补进 noSidebarViews
- `agents` 角色：补进 noSidebarViews
- `aiSchedules` 定时任务：补进 noSidebarViews

新增导航时的检查清单：
1. 从 settingsManagementViews 移除
2. 加入 noSidebarViews
3. 确认视图容器在 index.html 里是 `<section class="view ...">` 而非嵌套在设置布局内
4. 验证：点进去左侧不空、不出现设置菜单、内容占满整宽

