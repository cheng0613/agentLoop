import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import HarnessIcon from "./HarnessIcon.jsx";
import "./task-board.css";

// 任务状态到中文标签的映射。与后端 taskStatusFromRun 保持一致：
// queued / dispatched / running / completed / failed / cancelled
const TASK_STATUS_LABEL = {
  queued: "排队中",
  dispatched: "已调度",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const ACTIVE = new Set(["queued", "dispatched", "running"]);

function taskTone(task) {
  if (ACTIVE.has(task.status)) return "active";
  return task.status || "pending";
}

function elapsedLabel(from) {
  if (!from) return "";
  const start = new Date(from).getTime();
  if (!Number.isFinite(start)) return "";
  const mins = Math.max(0, Math.round((Date.now() - start) / 60000));
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function TaskCard({ task, issue, run, onOpen }) {
  const title = issue?.title || run?.input || task.id;
  const workflow = run?.workflowName || task.workflowId || "—";
  const nodes = run?.nodes ? Object.values(run.nodes) : [];
  const done = nodes.filter((n) => n?.status === "succeeded").length;
  const total = nodes.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const current = nodes.find((n) => n?.status === "running" || n?.status === "waiting_approval");
  const waiting = run?.nodes
    ? Object.values(run.nodes).find((n) => n?.status === "waiting_approval")
    : null;
  const tone = taskTone(task);

  return (
    <button
      type="button"
      className={`task-card task-card-${tone}`}
      onClick={() => onOpen?.(task)}
      title="查看任务详情"
    >
      <span className={`task-card-dot task-dot-${tone}`} aria-hidden="true" />
      <span className="task-card-body">
        <span className="task-card-title">{title}</span>
        <span className="task-card-meta">
          <span>{workflow}</span>
          {current?.name ? <span>· {current.name}</span> : null}
          <span>· {elapsedLabel(task.createdAt || run?.createdAt)}</span>
        </span>
        {total > 0 ? (
          <span className="task-card-progress" aria-hidden="true">
            <span className="task-card-bar">
              <span className="task-card-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="task-card-pct">
              {done}/{total}
            </span>
          </span>
        ) : null}
      </span>
      {waiting ? (
        <span className="task-card-flag">
          <HarnessIcon name="gate" size={13} />
          待确认
        </span>
      ) : null}
    </button>
  );
}

/**
 * 工作台任务看板。
 *
 * 任务优先于会话：用户打开工作台先看到「我在等什么 / 什么在等我」，
 * 需要开工时才落到下方的对话输入。
 *
 * 数据来自三个只读接口，按 taskID 做关联：
 *   /api/tasks  -> 调度实体（含 status / issueId / runId / workflowId）
 *   /api/runs   -> 运行态（含 nodes / workflowName / createdAt）
 *   /api/issues -> 需求标题
 */
export default function TaskBoard({ projectId, onOpenTask }) {
  const [tasks, setTasks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [taskList, runList, issueList] = await Promise.all([
        api("/api/tasks", { silent: true }),
        api("/api/runs", { silent: true }),
        api("/api/issues", { silent: true }),
      ]);
      setTasks(Array.isArray(taskList) ? taskList : []);
      setRuns(Array.isArray(runList) ? runList : []);
      setIssues(Array.isArray(issueList) ? issueList : []);
      setError("");
    } catch (err) {
      setError(err?.message || "无法加载任务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 任务状态变化快，看板保持 20 秒轮询；页面隐藏时不打扰后端。
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, 20000);
    return () => clearInterval(timer);
  }, [load]);

  const { active, done: finished } = useMemo(() => {
    const scoped = projectId
      ? tasks.filter((t) => {
          const issue = issues.find((i) => i.id === t.issueId);
          return !issue?.projectId || issue.projectId === projectId;
        })
      : tasks;
    const byTime = (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    const sorted = scoped.slice().sort(byTime);
    return {
      active: sorted.filter((t) => ACTIVE.has(t.status)),
      done: sorted.filter((t) => !ACTIVE.has(t.status)).slice(0, 3),
    };
  }, [tasks, issues, projectId]);

  const issueById = useMemo(
    () => Object.fromEntries(issues.map((i) => [i.id, i])),
    [issues],
  );
  const runById = useMemo(
    () => Object.fromEntries(runs.map((r) => [r.id, r])),
    [runs],
  );

  if (loading) {
    return (
      <section className="task-board" aria-label="任务看板">
        <div className="task-board-skeleton" role="status" aria-live="polite">
          正在加载任务…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="task-board" aria-label="任务看板">
        <div className="task-board-empty">
          <span>{error}</span>
          <button type="button" className="task-board-retry" onClick={load}>
            重试
          </button>
        </div>
      </section>
    );
  }

  if (!active.length && !finished.length) {
    return (
      <section className="task-board" aria-label="任务看板">
        <div className="task-board-empty">
          <span>还没有任务。在下方描述需求，或说 @ 引用角色与 SOP。</span>
        </div>
      </section>
    );
  }

  const renderCard = (task) => (
    <TaskCard
      key={task.id}
      task={task}
      issue={issueById[task.issueId]}
      run={runById[task.runId]}
      onOpen={onOpenTask}
    />
  );

  return (
    <section className="task-board" aria-label="任务看板">
      {active.length > 0 ? (
        <div className="task-board-group">
          <h2 className="task-board-heading">
            进行中
            <span className="task-board-count">{active.length}</span>
          </h2>
          <div className="task-board-list">{active.map(renderCard)}</div>
        </div>
      ) : null}
      {finished.length > 0 ? (
        <div className="task-board-group">
          <h2 className="task-board-heading task-board-heading-muted">
            最近完成
          </h2>
          <div className="task-board-list">{finished.map(renderCard)}</div>
        </div>
      ) : null}
    </section>
  );
}
