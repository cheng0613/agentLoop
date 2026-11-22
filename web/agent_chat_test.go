package web

import (
	"os/exec"
	"testing"
)

// startAgentChat 是角色页「会话」按钮的唯一出口，负责把点击转成一次带
// mentionRole 的跳转。它的 URL 拼接直接决定 chatbot 能否绑定到正确的角色，
// 所以单独覆盖：项目上下文、无项目、缺省值、编码与空 ID。
func TestStartAgentChatBuildsRoleMentionURL(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "agent_chat_test.js", appBundlePath(t)).CombinedOutput(); err != nil {
		t.Fatalf("startAgentChat: %v\n%s", err, out)
	}
}

// 角色会话靠 URL 约定横跨两个进程边界：父窗口的 startAgentChat 产出，
// iframe 内的 readRoleMention 消费。两侧一旦不同步，点「会话」会静默失
// 效，或把对话绑到错误的角色上。这个测试把两侧真实源码放进同一个 vm 做
// 往返验证，包括编码与缺省值。
func TestRoleChatURLRoundTrip(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "agent_chat_roundtrip_test.js", appBundlePath(t)).CombinedOutput(); err != nil {
		t.Fatalf("role chat round trip: %v\n%s", err, out)
	}
}

// 角色行模板一旦漏掉会话按钮、点击绑定断开、或表头与 CSS grid 列数
// 不一致，界面上会出现「点了没反应」或整行错位。这里对打包后的模板和
// product-v4.css 做静态断言。
func TestAgentRowExposesChatButton(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "agent_chat_render_test.js", appBundlePath(t)).CombinedOutput(); err != nil {
		t.Fatalf("agent chat button: %v\n%s", err, out)
	}
}
