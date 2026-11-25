-- 041: 助手工具调用审计表
--
-- 背景：排查「某个门禁是不是被模型自己批掉的」时三条线索全断——
-- 会话消息只记「正在调用模型…」、网关不打日志、运行事件没有操作者。
-- 于是把助手/定时任务经平台网关的工具调用单独落一张表。
--
-- 说明：
-- - 运行中的二进制会通过 gorm AutoMigrate 增量建表，这个脚本是给运维在
--   受限环境里手工建表用的基线定义，两边字段必须一致。
-- - 只记事实，不记凭据：args 在写入前已脱敏（token/password/secret/key
--   等字段替换为 ***）并截断到 1000 字符。
-- - outcome 取 ok / denied / error：denied 表示被审批模式或审查器拦下。
-- - 可按需清理：这张表只用于审计，保留 90 天足够；过久的数据可归档删除。

CREATE TABLE IF NOT EXISTS assistant_tool_calls (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  at          DATETIME(3)  NOT NULL,
  user_id     BIGINT       NULL,
  user_name   VARCHAR(128) NULL,
  project_id  VARCHAR(64)  NULL,
  session_id  VARCHAR(64)  NULL,
  run_id      VARCHAR(64)  NULL,
  mode        VARCHAR(32)  NULL,
  tool        VARCHAR(64)  NOT NULL,
  read_only   TINYINT(1)   NOT NULL DEFAULT 0,
  outcome     VARCHAR(16)  NOT NULL DEFAULT 'ok',
  error       VARCHAR(512) NULL,
  args        VARCHAR(1024) NULL,
  PRIMARY KEY (id),
  KEY idx_assistant_tool_calls_at (at),
  KEY idx_assistant_tool_calls_tool (tool),
  KEY idx_assistant_tool_calls_project (project_id),
  KEY idx_assistant_tool_calls_session (session_id),
  KEY idx_assistant_tool_calls_run (run_id),
  KEY idx_assistant_tool_calls_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
