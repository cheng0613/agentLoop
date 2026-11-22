-- 039: 平台共享凭据从「CodeBuddy 单行」扩展为「按 provider 多行」
--
-- 背景：团队部署使用统一 API 网关，成员不各自填写模型 Key。原实现只有
-- platform_codebuddy_keys 一张单行表（id 固定为 1），仅覆盖 CodeBuddy。
-- 本迁移新增 platform_provider_keys，每个 Agent CLI 一行，可分别配置
-- API Key、BaseURL、协议与模型列表。
--
-- 说明：
-- - 可重复执行。建表用 IF NOT EXISTS，回填用 ON DUPLICATE KEY UPDATE。
-- - 旧表 platform_codebuddy_keys 保留不删：SharedCodeBuddyKey 仍会兜底读取
--   它，便于回滚。确认新表稳定后再另行下线。
-- - base_url 为空表示该 CLI 的官方端点，因此历史 CodeBuddy Key 直接回填，
--   行为与迁移前一致。
-- - internet_environment 不进新表：统一网关下由 BaseURL 决定，不再靠环境
--   标签区分；读取兼容层会继续从旧表取该字段。

CREATE TABLE IF NOT EXISTS platform_provider_keys (
  provider      VARCHAR(64)  NOT NULL,
  api_key       TEXT         NOT NULL,
  base_url      TEXT         NOT NULL,
  protocol      VARCHAR(32)  NOT NULL DEFAULT '',
  models        TEXT         NOT NULL,
  default_model VARCHAR(191) NOT NULL DEFAULT '',
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by    BIGINT       NOT NULL DEFAULT 0,
  updated_at    DATETIME(3)  NULL,
  PRIMARY KEY (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 把已有的 CodeBuddy 共享 Key 迁到新表。只在旧表确有 Key 时写入，
-- 已在新表配置过的 provider 不覆盖（保留管理员后来的编辑）。
INSERT INTO platform_provider_keys
  (provider, api_key, base_url, protocol, models, default_model, enabled, updated_by, updated_at)
SELECT
  'codebuddy', src.api_key, '', '', src.models, '', 1, src.updated_by, src.updated_at
FROM platform_codebuddy_keys AS src
WHERE src.id = 1
  AND src.api_key <> ''
  AND src.models <> ''
ON DUPLICATE KEY UPDATE
  -- 新表已有该行时只补空字段，不覆盖既有配置
  api_key  = IF(platform_provider_keys.api_key = '', VALUES(api_key), platform_provider_keys.api_key),
  models   = IF(platform_provider_keys.models = '', VALUES(models), platform_provider_keys.models),
  updated_at = IF(platform_provider_keys.updated_at IS NULL, VALUES(updated_at), platform_provider_keys.updated_at);
