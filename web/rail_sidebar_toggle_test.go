package web

import (
	"os"
	"strings"
	"testing"
)

// rail 默认就是展开态（304px 的完整导航），收起由顶栏的折叠按钮负责。
// 底部那个「只显示图标」按钮已经去掉，这里守住「去掉之后仍然能收起」这件事。
func TestRailDefaultsToExpanded(t *testing.T) {
	htmlRaw, err := os.ReadFile("index.html")
	if err != nil {
		t.Fatal(err)
	}
	html := string(htmlRaw)

	if strings.Contains(html, `id="railSidebarToggle"`) {
		t.Fatal("the bottom 「只显示图标」 toggle is gone; collapsing lives in the rail header")
	}
	collapse := strings.Index(html, `id="railCollapseBtn"`)
	head := strings.Index(html, `class="rail-head"`)
	settings := strings.Index(html, `id="railSettingsEntry"`)
	if head < 0 || collapse < head || settings < 0 || collapse > settings {
		t.Fatal("the collapse button belongs in the rail header, above the entry list")
	}

	for _, label := range []string{"新建", "自动化", "插件", "搜索", "更多", "设置"} {
		if !strings.Contains(html, `<span class="rail-label">`+label+`</span>`) {
			t.Fatalf("expanded rail missing label %s", label)
		}
	}
	for _, id := range []string{"railPartners", "railPinned", "railProjects"} {
		if !strings.Contains(html, `id="`+id+`"`) {
			t.Fatalf("expanded rail missing section container %s", id)
		}
	}
	for _, moved := range []string{"流程模板", "运行记录", "定时任务"} {
		if strings.Contains(html, `<span class="rail-label">`+moved+`</span>`) {
			t.Fatalf("%s moved into the settings sidebar and must not stay on the rail", moved)
		}
	}

	app, err := os.ReadFile("app.js")
	if err != nil {
		t.Fatal(err)
	}
	src := string(app)
	// 默认展开、但记住用户上次的选择：没存过就是展开。
	if !strings.Contains(src, "setPlatformRailExpanded(readPlatformRailExpanded())") {
		t.Fatal("the rail must restore its last expanded state, defaulting to expanded")
	}
	if !strings.Contains(src, "localStorage.getItem(PLATFORM_RAIL_STORAGE_KEY)") ||
		!strings.Contains(src, "localStorage.setItem(PLATFORM_RAIL_STORAGE_KEY") {
		t.Fatal("the rail must persist its expanded state in localStorage")
	}
	// 没存过时 readPlatformRailExpanded 必须返回 true。
	readStart := strings.Index(src, "function readPlatformRailExpanded()")
	if readStart < 0 {
		t.Fatal("missing readPlatformRailExpanded")
	}
	readBody := src[readStart : readStart+strings.Index(src[readStart:], "\n}")]
	if !strings.Contains(readBody, "return true") {
		t.Fatal("the rail defaults to expanded when nothing is stored")
	}
	// 展开态才渲染伙伴/置顶/全部任务，所以展开后必须重跑一次渲染。
	start := strings.Index(src, "function setPlatformRailExpanded(")
	if start < 0 {
		t.Fatal("missing setPlatformRailExpanded")
	}
	end := strings.Index(src[start:], "\n}")
	body := src[start : start+end]
	if !strings.Contains(body, "renderRailNav()") {
		t.Fatal("expanding the rail must re-render its sections")
	}
	if strings.Contains(src, "setPlatformRailCollapsed(") || strings.Contains(src, "platform-rail-collapsed") {
		t.Fatal("the rail collapses by hiding labels, not by collapsing away")
	}

	css, err := os.ReadFile("product-v4.css")
	if err != nil {
		t.Fatal(err)
	}
	sheet := string(css)
	if !strings.Contains(sheet, "body.platform-rail-expanded") || !strings.Contains(sheet, "--rail-w: 304px") || !strings.Contains(sheet, "body.platform-rail-expanded .platform-rail .rail-label") {
		t.Fatal("expanded icon rail must widen and show labels")
	}
	if strings.Contains(sheet, "platform-rail-collapsed") || strings.Contains(sheet, "--rail-w: 0px") {
		t.Fatal("icon rail must stay visible when labels are hidden")
	}
}
