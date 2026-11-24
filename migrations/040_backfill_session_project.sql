-- 040: 把无项目的历史会话归入其所属用户的项目
--
-- 背景：工作台的会话侧栏已改为严格按项目过滤（只列当前项目下的会话），
-- 宿主 rail 负责项目之间的切换。没有 project_id 的会话因此永远不会出现
-- 在侧栏里——数据还在库里，但用户再也看不到。
--
-- 这批数据来自早期版本：那时新建会话可以不选项目，或者由「个人对话」
-- 入口直接开启。现在定时任务与普通会话都必须绑定项目，所以历史数据
-- 需要一次性补齐归属。
--
-- 回填规则（按优先级，只处理 project_id 为空的行）：
--   1. 会话所属用户是某个项目的 owner → 取该项目；
--   2. 会话所属用户是某个项目的成员 → 取 project_members 里的项目；
--   3. 以上都没有 → 全库仅有一个项目时取它，否则保持为空不动。
--      保持为空是有意的：宁可留着让人手工处理，也不要随机塞进一个
--      不相干的项目。
--
-- 说明：
-- - 可重复执行：每一步都用 WHERE 排除已归属的行，重复跑不再改动数据。
-- - 只做数据补齐，不改表结构。回滚就是把这几行 project_id 置回空串。
-- - 由 SOP 运行或需求反推项目没有做：assistant_sessions 只有 id/user_id/
--   project_id/title/model/source/task_id/payload 这些列，run_id 与 issue_id
--   都藏在 payload JSON 里，而现存的无主会话 payload 中并没有这两个字段。
--   将来若出现带 runId 的无主会话，可以按 payload->>'$.runId' 关联 runs
--   的 quota_project_id 再补一条。
-- - 第 2 步取 member 的最小 project_id，避免一人多项目时结果不稳定。

-- 1. 会话所属用户是项目 owner
UPDATE assistant_sessions s
JOIN (
  SELECT owner_user_id, MIN(id) AS project_id
  FROM projects
  WHERE owner_user_id > 0 AND id <> ''
  GROUP BY owner_user_id
) p ON p.owner_user_id = s.user_id
SET s.project_id = p.project_id
WHERE (s.project_id IS NULL OR s.project_id = '')
  AND s.user_id > 0;

-- 2. 会话所属用户是项目成员
UPDATE assistant_sessions s
JOIN (
  SELECT user_id, MIN(project_id) AS project_id
  FROM project_members
  WHERE user_id > 0 AND project_id <> ''
  GROUP BY user_id
) m ON m.user_id = s.user_id
SET s.project_id = m.project_id
WHERE (s.project_id IS NULL OR s.project_id = '')
  AND s.user_id > 0;

-- 3. 兜底：全库只有一个项目时，剩下无主会话都归它
UPDATE assistant_sessions s
JOIN (SELECT MIN(id) AS project_id FROM projects) p
  ON (SELECT COUNT(*) FROM projects) = 1
SET s.project_id = p.project_id
WHERE (s.project_id IS NULL OR s.project_id = '')
  AND p.project_id IS NOT NULL
  AND p.project_id <> '';
