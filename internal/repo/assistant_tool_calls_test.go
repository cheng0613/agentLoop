package repo

import (
	"testing"
	"time"

	"agentflow/internal/domain"
)

// 审计记录要能按项目与时间取回，供排查使用。
func TestRecordAssistantToolCall(t *testing.T) {
	st, err := OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	now := time.Now().UTC()
	calls := []domain.AssistantToolCall{
		{At: now.Add(-2 * time.Minute), UserID: 1, UserName: "admin", ProjectID: "p1", Tool: "runs_approve", Outcome: "ok"},
		{At: now.Add(-time.Minute), UserID: 1, UserName: "admin", ProjectID: "p1", Tool: "runs_get", ReadOnly: true, Outcome: "ok"},
		{At: now, UserID: 1, UserName: "admin", ProjectID: "p2", Tool: "runs_approve", Outcome: "denied", Error: "不可在当前审批模式下直接调用"},
	}
	for _, call := range calls {
		if err := st.RecordAssistantToolCall(call); err != nil {
			t.Fatal(err)
		}
	}

	got := st.RecentAssistantToolCalls("p1", 10)
	if len(got) != 2 {
		t.Fatalf("want 2 calls for p1, got %d", len(got))
	}
	// 倒序：最新的在前。
	if got[0].Tool != "runs_get" || !got[0].ReadOnly {
		t.Fatalf("unexpected order: %+v", got)
	}
	if got[1].Tool != "runs_approve" || got[1].Outcome != "ok" {
		t.Fatalf("unexpected row: %+v", got[1])
	}

	all := st.RecentAssistantToolCalls("", 10)
	if len(all) != 3 {
		t.Fatalf("want 3 calls overall, got %d", len(all))
	}
	if all[0].Outcome != "denied" || all[0].Error == "" {
		t.Fatalf("denied call must keep its reason: %+v", all[0])
	}
}
