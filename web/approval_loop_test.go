package web

import (
	"os/exec"
	"testing"
)

// 审批闭环的三个环节：产物内联排序、卡片锚点、批准后跳到下一条。
// 这些都不影响编译，只在界面上静默失效，所以单独锁住。
func TestApprovalLoopInlineArtifacts(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "approval_loop_test.js", appBundlePath(t)).CombinedOutput(); err != nil {
		t.Fatalf("approval loop: %v\n%s", err, out)
	}
}

// 需求抽屉从 9 个 tab 收敛为 3 个后，列表页与历史深链仍可能带旧 id。
// 这里确认旧 id 都能落到合并后的 pane，且表头按钮与别名表一致。
func TestIssueDrawerTabsCollapsed(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "issue_drawer_tabs_test.js", appBundlePath(t)).CombinedOutput(); err != nil {
		t.Fatalf("issue drawer tabs: %v\n%s", err, out)
	}
}
