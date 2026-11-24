# 节点角色问答：现状、缺口与落地规划

这份文档回答一个具体问题：**在聊天里 @ 某个 SOP 节点的角色，它能不能说出自己做了什么、产出什么、卡在哪里？**
结论先写，后面是完整的缺口清单与分期。

---

## 一、现状：能，但不是"那个角色在说话"

系统里已有三块现成能力，但彼此没有串起来。

| 问法 | 现在会发生什么 | 结论 |
|---|---|---|
| @整条运行 | `assistant_workbench.go` 的 `run` 分支把**每个节点的 output（限 4000 字）、error、状态、attempt、reworkCount、agentId** 一并注入上下文 | ✅ 产出与问题读得到 |
| @角色 | 注入角色的 `prompt`、`description`，并挂载该角色配置的 MCP servers | ⚠️ 有角色任务书，但**没有它在本条 run 里的产出** |
| @某节点的角色 | 没有 node 级引用类型，只能退化成上面两种之一 | ❌ 做不了 |
| @正在执行 / 未执行的节点 | 同上 | ❌ 没有"还没开始"的语义 |

也就是说：**能力是存在的，但分散在"运行引用"和"角色引用"两条路上，没有"节点"这个粒度。**

助手还可以自己调 `runs_get` / `runs_artifact_get` / `issues_runs_list` 去查，但系统提示里没有"看到角色引用就去读它产出"的规则，**是否真查取决于模型当次行为**，因此结果不可预期。

### 关键数据都在（admin 项目实测）

| 节点 | 状态 | output | 独立 CLI 会话 |
|---|---|---|---|
| requirement | succeeded | 442 字 | `01a20666-6130…` |
| design | succeeded | 571 字 | ✓ |
| review | succeeded | 625 字 | `01a2066f-bde4…` |
| test | succeeded | 529 字 | `01a206c3-4778…` |
| mr | succeeded | 616 字 | `01a206f6-7fcf…` |
| summary | succeeded | 622 字 | `01a2071a-c0be…` |

`NodeRun` 有 `Output / Error / Feedback / GateResult / Activity / Attempt / ReworkCount / Provider / Model / StartedAt / FinishedAt / SessionID`；
`WorkflowSnapshot.Edges` 给出交接关系；`artifacts[].nodeId` 把产物归到节点。

**缺的只是"节点"这一层的引用与提示词规则，不是数据。**

---

## 二、缺口清单

### P0 · 后端（做完即只读问答可用）

1. **新增引用类型 `runNode`**
   载荷 `{type:"runNode", id:"<runId>:<nodeId>", runId, nodeId}`。
   落点：`internal/httpapi/assistant_workbench.go` 的 `workbenchReference` 与 `accessibleWorkbenchReference`。

2. **`runNode` 分支要注入的事实块**
   ```
   run: <runId> · <SOP 名> · <run.status>
   node: <节点名> · <角色名(agentId 解析)> · <status>
   耗时: finishedAt-startedAt    尝试: attempt / 返工 reworkCount
   执行器: provider / model
   输出: <output，截 2000 字>
   错误: <error，截 800 字>
   产物: [<name> …]（只给清单，内容按需 runs_artifact_get）
   移交: → <edges[source].target 的节点名>；无出边时标为流程终点
   ```
   未执行（`pending` / 无 `nodes[nodeId]`）时写死一句：**该节点尚未开始，没有产出。**

3. **权限校验**
   节点所属 run 的 `ExecutionContext.ProjectID` 必须等于当前项目，沿用现有 `accessibleWorkbenchReference` 的 `project` 比对；否则报"引用对象不存在或不属于当前项目"。

4. **提示词规则**（`assistantCommonTailPrompt` 追加一条）
   > 消息中出现 `runNode` 引用时，回答必须以该引用块为唯一事实来源；块里写明"尚未开始"时直接说明，不得编造产出或产物名。

5. **产物内容按需**
   事实块只给产物名；需要正文时走已有的 `runs_artifact_get`，不预读全部内容（避免上下文爆炸）。

### P1 · 前端

6. **@ 列表新增「SOP 节点」**
   候选来源：当前会话若绑定 `runId`（群会话/需求上下文），用 `runs_get` 取该 run 的 `workflowSnapshot.nodes` + `nodes[].status` 生成候选项。落点：`chatbot/src/mentions.js` 的 `referenceTypes` 与 `App.jsx` 的候选构造处。

7. **未执行节点也可选**
   候选上带「未开始」徽标，选中后 `@节点名` 并在引用里带上 `runNode`。这样"问还没跑的节点"是被支持的，回答会明确说没有产出。

8. **引用 chip**
   会话里 `@节点` 的 chip 显示状态点（完成/进行中/待确认/未开始），悬停给产物数。

9. **项目房间入口**
   房间页每个节点气泡上加「问这个角色」：切到工作台、复用/新开该项目的会话，并预填 `@节点名` 的 `runNode` 引用。

### P2 · 增强（按需）

10. **真角色记忆：resume 节点会话**
    `NodeRun.SessionID` 已有值，运行时支持 `--resume`（`runtime/provider_agentcli.go:147`、`conversation_zcode.go:17`）。
    但 `provider_claude.go:56` 会丢弃 `--resume`，因此需要**按 provider 探测能力**并降级。风险：节点会话携带工作区上下文，跨会话复用需权限闸与用户显式确认。

11. **门禁原因落库**
    `NodeRun.Feedback` 字段存在但实测为空；"问题所在"目前只能从 `output` / `error` 推断。若要让回答精确到"为什么退回"，需要在引擎门禁退回时写入结构化原因。

12. **"谁分配"字段**
    `Issue` / `Run` 都没有 `dispatchedBy`。现在只能回答需求负责人。要回答"谁派发给我"，需要新增列 + 迁移 + 写入点。

---

## 三、验收标准

1. 对已完成节点逐个提问，答案中的 **产出文件名、耗时、结论** 与 `runs_get` / `artifacts` 一致（抽 3 个节点比对）。
2. 对 `pending` 节点提问，回答必须包含"还没开始"，且**不得出现任何产物名**。
3. 跨项目引用节点 → 400，提示"不属于当前项目"。
4. 非项目成员引用节点 → 拒绝。
5. 项目房间点「问这个角色」→ 会话里出现正确的 `@节点` 引用，且答案能引到该节点事实。

---

## 四、分期与顺序

| 阶段 | 内容 | 交付物 | 依赖 |
|---|---|---|---|
| **阶段 1** | P0-1..5（后端 `runNode` 引用 + 事实注入 + 提示词） | 接口可用，curl / 会话内手填引用即可验证 | 无（数据齐全） |
| **阶段 2** | P1-6..9（前端 @ 节点、chip、房间入口） | 用户可点选，不需手写引用 | 阶段 1 |
| **阶段 3** | P2-10..12（resume、门禁原因、dispatchedBy） | 真记忆与精确归因 | 需要引擎侧改动 |

阶段 1 是**唯一必须的**：做完之后"问已完成节点"就变成确定性行为；阶段 2 只是把入口做顺手。

---

## 五、风险与取舍

- **上下文长度**：单节点 output 可能 4000+ 字。事实块上限取 2000 字，产物只给清单；多节点提问靠多次引用而不是一次全注入。
- **提示词冲突**：现有提示词围绕"写操作先出草稿"。`runNode` 规则必须限定在只读问答分支，不能影响草稿协议。
- **resume 的边界**：节点会话可能包含工作区文件内容与凭据上下文，跨会话复用必须先做权限断言，并让用户显式选择"继续该角色的会话"。
- **不承诺**：除非做 P2-10，`@角色` 始终是"聊天助手拿着角色任务书回答问题"，不是角色本人发言。

---

## 六、当前可以立刻用的替代做法

在阶段 1 完成前，用户的等效路径是 **@整条运行**（`run` 引用）：它已经把每个节点的 output 与 error 注入上下文，因此"这条 SOP 里评审节点发现了什么问题"这类问题能答准。差别是不能只问某一个节点、也不区分"未开始"。
