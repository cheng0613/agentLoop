package web

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestAssistantSettingsPageIsWired(t *testing.T) {
	read := func(name string) string {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	index, app, ui, motion := read("index.html"), read("app.js"), read("app/harness-ui.css"), read("app/harness-motion.js")
	for _, want := range []string{`data-view="assistant"`, `<section id="assistantView" class="view page-view">`, `<div id="assistantContent">`, `/app/assistant-settings.css`, `/app/assistant-settings.js`} {
		if !strings.Contains(index, want) {
			t.Fatalf("index.html is missing %q", want)
		}
	}
	// 设置侧栏里 AI 助手跟在个人配置之后、项目分组之前。
	// rail 的「更多」菜单也带 settings/bots 入口，所以只在设置侧栏范围内比顺序。
	sidebar := index[strings.Index(index, `id="settingsSidebar"`):]
	sidebarSettings := strings.Index(sidebar, `data-view="settings"`)
	sidebarAssistant := strings.Index(sidebar, `data-view="assistant"`)
	sidebarBots := strings.Index(sidebar, `data-view="bots"`)
	if sidebarSettings < 0 || sidebarAssistant < 0 || sidebarBots < 0 ||
		sidebarAssistant < sidebarSettings || sidebarAssistant > sidebarBots {
		t.Fatal("AI 助手 belongs with personal settings, ahead of the project section")
	}
	for _, want := range []string{"'settings','assistant'", "assistant:'AI 助手'", "if(name==='assistant')loadAssistantSettings();"} {
		if !strings.Contains(app, want) {
			t.Fatalf("app.js is missing %q", want)
		}
	}
	if !strings.Contains(motion, `assistant: "sparkles"`) {
		t.Fatal("the AI 助手 nav entry needs its Harness icon")
	}
	if got, want := strings.Count(ui, "#assistantView"), strings.Count(ui, "#botsView"); got != want {
		t.Fatalf("#assistantView must join every Harness scope #botsView is in: %d vs %d", got, want)
	}
}

func TestAssistantSettingsForm(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "assistant_settings_test.js", "app/assistant-settings.js").CombinedOutput(); err != nil {
		t.Fatalf("assistant settings: %v\n%s", err, out)
	}
}
