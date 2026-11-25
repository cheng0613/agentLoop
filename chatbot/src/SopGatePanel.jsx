import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import HarnessIcon from "./HarnessIcon";
import "./sop-gate.css";

// SOP 人工门禁：SOP 走到需要人拍板的节点时会停住。这里在会话里就地给出
// 批准 / 退回，和「待我确认」弹窗调用同一组接口（/api/runs/:id/approve|
// reject），两边状态一致。
//
// 门禁不是角色，也不是 MainBot 的任务：它由人决定。面板只负责把卡点摆到
// 对话里，操作仍然是人点的。
function gateTarget(node, nodes) {
  const id = String(node?.rejectTo || "").trim();
  if (!id) return null;
  return nodes.find((n) => n.id === id) || { id, name: id };
}

export default function SopGatePanel({ chat, onChange }) {
  const [gates, setGates] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  // 退回必须写原因，但项目禁止原生弹窗：就在卡片里展开一个输入框。
  const [rejecting, setRejecting] = useState("");
  const [reason, setReason] = useState("验证未通过，请上游修复后重新提交");
  const sessionId = chat.session?.id;
  const runIds = useRef([]);

  // 这条会话涉及哪些运行：会话自身的 runId，加上消息里带的 runIds。
  const collectRuns = useCallback(() => {
    const ids = new Set();
    const own = String(chat.session?.runId || "").trim();
    if (own) ids.add(own);
    for (const message of chat.session?.messages || []) {
      for (const id of message.runIds || []) {
        const runId = String(id || "").trim();
        if (runId) ids.add(runId);
      }
    }
    return [...ids].slice(-5);
  }, [chat.session]);

  useEffect(() => {
    setGates([]);
    setError("");
    if (!sessionId || chat.local || chat.readOnly) return;
    let closed = false;

    async function refresh() {
      const ids = collectRuns();
      runIds.current = ids;
      if (!ids.length) {
        if (!closed) setGates([]);
        return;
      }
      try {
        const found = [];
        for (const runId of ids) {
          const run = await api(`/api/runs/${encodeURIComponent(runId)}`, { silent: true });
          if (closed) return;
          const nodes = run?.workflowSnapshot?.nodes || [];
          for (const [nodeId, nr] of Object.entries(run?.nodes || {})) {
            const status = String(nr?.status || "");
            if (status !== "waiting_approval" && status !== "waiting") continue;
            const def = nodes.find((n) => n.id === nodeId) || { id: nodeId };
            // 只处理人工门禁：由人拍板的节点。
            if (def.type && def.type !== "approval") continue;
            found.push({
              runId,
              runStatus: String(run?.status || ""),
              nodeId,
              name: def.name || nodeId,
              activity: String(nr?.activity || "").trim(),
              output: String(nr?.output || "").trim(),
              target: gateTarget(def, nodes),
            });
          }
        }
        if (!closed) setGates(found);
      } catch (e) {
        if (!closed) setError(e.message);
      }
    }

    void refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [sessionId, chat.local, chat.readOnly, collectRuns, chat.session?.updatedAt]);

  async function approve(gate) {
    setBusy(`${gate.runId}:${gate.nodeId}`);
    setError("");
    try {
      await api(`/api/runs/${encodeURIComponent(gate.runId)}/approve`, {
        method: "POST",
        body: JSON.stringify({ nodeId: gate.nodeId }),
      });
      setGates((old) => old.filter((x) => !(x.runId === gate.runId && x.nodeId === gate.nodeId)));
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function reject(gate, text) {
    if (!gate.target) {
      setError("这个节点没有配置上游返工目标，只能批准");
      return;
    }
    setBusy(`${gate.runId}:${gate.nodeId}`);
    setError("");
    try {
      await api(`/api/runs/${encodeURIComponent(gate.runId)}/reject`, {
        method: "POST",
        body: JSON.stringify({
          nodeId: gate.nodeId,
          targetId: gate.target.id,
          reason: String(text || "").trim(),
        }),
      });
      setGates((old) => old.filter((x) => !(x.runId === gate.runId && x.nodeId === gate.nodeId)));
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  if (!gates.length && !error) return null;

  return (
    <section className="sop-gate" aria-label="SOP 人工确认">
      {gates.map((gate) => (
        <div className="sop-gate-card" key={`${gate.runId}:${gate.nodeId}`}>
          <div className="sop-gate-head">
            <HarnessIcon name="gate" size={14} />
            <b>{gate.name}</b>
            <span>等待你确认</span>
          </div>
          {gate.output ? (
            <p className="sop-gate-output">{gate.output.slice(0, 400)}</p>
          ) : null}
          <div className="sop-gate-actions">
            <button
              type="button"
              className="button primary small"
              disabled={!!busy}
              onClick={() => void approve(gate)}
            >
              {busy === `${gate.runId}:${gate.nodeId}` ? "处理中…" : "批准，继续下一步"}
            </button>
            {gate.target ? (
              <button
                type="button"
                className="button ghost small"
                disabled={!!busy}
                onClick={() =>
                  setRejecting(
                    rejecting === gate.nodeId ? "" : gate.nodeId,
                  )
                }
              >
                退回「{gate.target.name}」
              </button>
            ) : null}
          </div>
          {rejecting === gate.nodeId && gate.target ? (
            <div className="sop-gate-reject">
              <label>
                退回「{gate.target.name}」会重置该节点及其全部下游，请写清原因：
                <textarea
                  value={reason}
                  rows={2}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="sop-gate-actions">
                <button
                  type="button"
                  className="button danger-outline small"
                  disabled={!!busy || !reason.trim()}
                  onClick={() => void reject(gate, reason)}
                >
                  确认退回
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => setRejecting("")}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p className="sop-gate-error">{error}</p> : null}
    </section>
  );
}
