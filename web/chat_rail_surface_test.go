package web

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// lastCSSValue returns the property's value from the last top-level rule for
// selector that declares it, mirroring the cascade for same-specificity rules.
func lastCSSValue(css, selector, property string) string {
	pattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(selector) + `\s*\{([^}]*)\}`)
	value := ""
	for _, m := range pattern.FindAllStringSubmatch(css, -1) {
		if v := sidebarCSSValue(m[1], property); v != "" {
			value = v
		}
	}
	return value
}

var cssVarRef = regexp.MustCompile(`^var\((--[a-z0-9-]+)\)$`)

// themeScope narrows tokens.css to the block for one theme: the light palette
// lives under html[data-theme="light"], the dark one is the bare :root default.
func themeScope(t *testing.T, source, theme string) string {
	t.Helper()
	if theme != "light" {
		return source
	}
	i := strings.Index(source, `[data-theme="light"]`)
	if i < 0 {
		t.Fatal("tokens.css has no light theme block")
	}
	rest := source[i:]
	// The light block ends where the next top-level selector starts.
	if j := strings.Index(rest[1:], "\ndata-theme="); j >= 0 {
		return rest[:j+1]
	}
	return rest
}

// resolveCSSColor follows var(--token) references until it reaches a literal
// colour, so a token on one side can be compared with a literal on the other.
func resolveCSSColor(t *testing.T, value string, sheets ...string) string {
	t.Helper()
	for depth := 0; depth < 8; depth++ {
		m := cssVarRef.FindStringSubmatch(strings.TrimSpace(value))
		if m == nil {
			return value
		}
		resolved := ""
		for _, sheet := range sheets {
			pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(m[1]) + `:\s*([^;]+);`)
			if hit := pattern.FindStringSubmatch(sheet); hit != nil {
				resolved = strings.TrimSpace(hit[1])
			}
		}
		if resolved == "" {
			t.Fatalf("cannot resolve %s", m[1])
		}
		value = resolved
	}
	t.Fatalf("var() chain too deep for %s", value)
	return value
}

// The host icon rail and the chat sidebar are one continuous gray strip: the rail
// paints the left edge and .chat-shell::after paints the rest, with the white
// conversation card sitting on top. They must therefore resolve to the same color.
func TestChatShellRailMatchesHostRailSurface(t *testing.T) {
	host, err := os.ReadFile("product-v4.css")
	if err != nil {
		t.Fatal(err)
	}
	tokens, err := os.ReadFile("tokens.css")
	if err != nil {
		t.Fatal(err)
	}
	chat, err := os.ReadFile("../chatbot/src/navigation.css")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		theme        string
		hostSelector string
		chatSelector string
	}{
		{"light", ":root", ".chat-shell"},
		{"dark", `html[data-theme="dark"]`, `[data-theme="dark"] .chat-shell`},
	}
	for _, c := range cases {
		raw := lastCSSValue(string(host), c.hostSelector, "--rail-surface")
		if raw == "" {
			t.Fatalf("%s: %s missing --rail-surface", c.theme, c.hostSelector)
		}
		// product-v4.css overrides some tokens per theme; search it first so its
		// value wins, then fall back to the scoped palette in tokens.css.
		want := resolveCSSColor(t, raw, themeScope(t, string(host), c.theme), themeScope(t, string(tokens), c.theme))
		got := lastCSSValue(string(chat), c.chatSelector, "--navigation-rail")
		if got != want {
			t.Errorf("%s: %s { --navigation-rail } = %q, want host --rail-surface %q (from %q)", c.theme, c.chatSelector, got, want, raw)
		}
	}
}
