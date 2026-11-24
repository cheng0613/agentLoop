package engine

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"agentflow/internal/domain"
)

// SOP 节点进度写进共享会话：群里按节点出现消息，前端就能像看聊天一样
// 看到流程走到哪。用 Trigger/TriggerID 做幂等，引擎重试不会重复刷屏。
//
// 默认开启；设 AGENTFLOW_SOP_CHAT_FEED=0 可关掉（老部署、或不想让引擎
// 往会话里写东西时）。
func sopChatFeedEnabled() bool {
	raw := strings.TrimSpace(os.Getenv("AGENTFLOW_SOP_CHAT_FEED"))
	if raw == "" {
		return true
	}
	on, err := strconv.ParseBool(raw)
	return err == nil && on
}

// announceNode 把一次节点状态变化写成一条会话消息。失败只记日志：汇报是
// 附属能力，不能因为它影响 SOP 执行。
func (e *Engine) announceNode(r *domain.Run, nodeID, kind, summary string) {
	if !sopChatFeedEnabled() || r == nil || nodeID == "" {
		return
	}
	if r.IsWorkspace() {
		return
	}
	project := strings.TrimSpace(r.ExecutionContext.ProjectID)
	if project == "" {
		return
	}
	node := r.Nodes[nodeID]
	attempt := 1
	if node != nil && node.Attempt > 0 {
		attempt = node.Attempt
	}
	def := nodeDefinition(r, nodeID)
	name := strings.TrimSpace(def.Name)
	if name == "" {
		name = nodeID
	}
	speaker := strings.TrimSpace(def.Name)
	if agentID := strings.TrimSpace(def.AgentID); agentID != "" {
		if role, ok := e.repo.Agent(agentID); ok && strings.TrimSpace(role.Name) != "" {
			speaker = role.Name
		}
	}
	if speaker == "" {
		speaker = "SOP"
	}
	content := fmt.Sprintf("【%s】%s", name, strings.TrimSpace(summary))
	if node != nil && strings.TrimSpace(node.Error) != "" && kind == "node.failed" {
		content = fmt.Sprintf("【%s】%s\n%s", name, strings.TrimSpace(summary), strings.TrimSpace(node.Error))
	}
	title := strings.TrimSpace(r.WorkflowSnapshot.Name)
	if title == "" {
		title = r.WorkflowID
	}
	msg := domain.AssistantMessage{
		Role:           "assistant",
		Content:        content,
		SpeakerName:    speaker,
		SpeakerAgentID: strings.TrimSpace(def.AgentID),
		RunIDs:         []string{r.ID},
		Trigger:        "sop_node",
		TriggerID:      fmt.Sprintf("%s:%s:%s:%d", r.ID, nodeID, kind, attempt),
		CreatedAt:      time.Now().UTC(),
	}
	if _, err := e.repo.AppendRunChatEvent(r.ID, project, title, r.ExecutionContext.ResponsibleUserID, msg); err != nil {
		log.Printf("sop chat feed: run=%s node=%s kind=%s: %v", r.ID, nodeID, kind, err)
	}
}

// nodeDefinition 取流程定义里的节点；运行快照缺节点时返回空结构。
func nodeDefinition(r *domain.Run, nodeID string) domain.WorkflowNode {
	for _, node := range r.WorkflowSnapshot.Nodes {
		if node.ID == nodeID {
			return node
		}
	}
	return domain.WorkflowNode{ID: nodeID}
}
