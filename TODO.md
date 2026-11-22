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
