package web

import (
	"os/exec"
	"testing"
)

// rail 展开态的三段动态内容（伙伴 / 置顶 / 全部任务）由 app/rail-nav.js 渲染，
// 这个用例用 fake DOM 断言它生成的行结构、头像取字和空态。
func TestRailNavSections(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "rail_nav_test.js").CombinedOutput(); err != nil {
		t.Fatalf("rail nav sections: %v\n%s", err, out)
	}
}
