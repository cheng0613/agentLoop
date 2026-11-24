package repo

import (
	"testing"
	"time"

	"agentflow/internal/domain"
)

// 同一个节点事件重复到达（引擎重试/重放）不能重复写消息。
func TestAppendRunChatEventIsIdempotent(t *testing.T) {
	st, err := OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	const runID, projectID, owner = "run-feed-1", "proj-feed", int64(7)
	msg := domain.AssistantMessage{
		Role:        "assistant",
		Content:     "【需求定型】已完成，产出已登记",
		SpeakerName: "产品经理",
		Trigger:     "sop_node",
		TriggerID:   runID + ":requirement:node.succeeded:1",
		CreatedAt:   time.Now().UTC(),
	}

	written, err := st.AppendRunChatEvent(runID, projectID, "后端交付 SOP", owner, msg)
	if err != nil {
		t.Fatal(err)
	}
	if !written {
		t.Fatal("first append must write")
	}

	// 同一事件再来一次：不写。
	again, err := st.AppendRunChatEvent(runID, projectID, "后端交付 SOP", owner, msg)
	if err != nil {
		t.Fatal(err)
	}
	if again {
		t.Fatal("duplicate trigger must not append again")
	}

	// 换一个节点事件：要写。
	msg.TriggerID = runID + ":design:node.started:1"
	msg.Content = "【方案设计】开始执行"
	if written, err = st.AppendRunChatEvent(runID, projectID, "后端交付 SOP", owner, msg); err != nil || !written {
		t.Fatalf("second node event must write: written=%v err=%v", written, err)
	}

	session, ok := st.SharedAssistantSession(RunAssistantSessionID(runID))
	if !ok {
		t.Fatal("run session should exist")
	}
	if len(session.Messages) != 2 {
		t.Fatalf("want 2 messages, got %d", len(session.Messages))
	}
	if session.Messages[0].SpeakerName != "产品经理" || session.Messages[1].Content != "【方案设计】开始执行" {
		t.Fatalf("unexpected messages: %+v", session.Messages)
	}
	if !session.Shared || session.RunID != runID || session.ProjectID != projectID {
		t.Fatalf("session binding wrong: shared=%v run=%s project=%s", session.Shared, session.RunID, session.ProjectID)
	}
}

// 没有项目的运行不写（避免产生无处展示的会话）。
func TestAppendRunChatEventSkipsWithoutProject(t *testing.T) {
	st, err := OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	written, err := st.AppendRunChatEvent("run-feed-2", "", "SOP", 1, domain.AssistantMessage{
		Role: "assistant", Content: "x", Trigger: "sop_node", TriggerID: "run-feed-2:a:node.started:1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if written {
		t.Fatal("must not write without project")
	}
	if _, ok := st.SharedAssistantSession(RunAssistantSessionID("run-feed-2")); ok {
		t.Fatal("must not create a session without project")
	}
}
