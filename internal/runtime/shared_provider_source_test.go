package runtime

import (
	"testing"

	"agentflow/internal/domain"
)

// 共享凭据来源是进程级注册的，测试之间要显式清空，避免相互污染。
func withSharedSource(t *testing.T, src SharedProviderCredentialSource) {
	t.Helper()
	RegisterSharedProviderCredentialSource(src)
	t.Cleanup(func() { RegisterSharedProviderCredentialSource(nil) })
}

// 未注册来源时行为必须与改造前一致：只返回个人配置，没有就返回 nil。
func TestAgentCLIUserCredentialsWithoutSharedSource(t *testing.T) {
	withSharedSource(t, nil)
	user := domain.User{AgentCLICredentials: map[string]domain.AgentCLICredential{
		"opencode": {APIKey: "sk-personal", BaseURL: "https://personal.test"},
	}}
	got := AgentCLIUserCredentials(user)
	if len(got) != 1 {
		t.Fatalf("expected only personal credentials, got %d", len(got))
	}
	if got["opencode"].APIKey != "sk-personal" {
		t.Fatalf("api key = %q", got["opencode"].APIKey)
	}

	empty := AgentCLIUserCredentials(domain.User{})
	if empty != nil {
		t.Fatalf("no credentials anywhere must return nil, got %v", empty)
	}
}

// 个人没配的 CLI 用平台共享凭据补齐，这是统一网关部署的主路径。
func TestAgentCLIUserCredentialsFillsFromShared(t *testing.T) {
	withSharedSource(t, func(kind string) (ProviderCredential, bool) {
		if kind != "kimi" {
			return ProviderCredential{}, false
		}
		return ProviderCredential{
			APIKey:   "sk-shared",
			BaseURL:  "https://gw.internal.test/v1",
			Protocol: domain.AgentCLIProtocolMessages,
			Models:   []domain.CLIModel{{ID: "gw-model"}},
		}, true
	})
	got := AgentCLIUserCredentials(domain.User{})
	if len(got) == 0 {
		t.Fatal("shared credentials must populate the map even without personal config")
	}
	kimi, ok := got["kimi"]
	if !ok {
		t.Fatal("kimi must be filled from the shared source")
	}
	if kimi.APIKey != "sk-shared" {
		t.Fatalf("api key = %q", kimi.APIKey)
	}
	if kimi.BaseURL != "https://gw.internal.test/v1" {
		t.Fatalf("base url must flow through for gateway deployments: %q", kimi.BaseURL)
	}
	if kimi.Protocol != domain.AgentCLIProtocolMessages {
		t.Fatalf("protocol = %q", kimi.Protocol)
	}
	if len(kimi.Models) != 1 || kimi.Models[0].ID != "gw-model" {
		t.Fatalf("models = %v", kimi.Models)
	}
}

// 个人配置必须优先，不能被共享值覆盖。
func TestAgentCLIUserCredentialsPersonalWins(t *testing.T) {
	withSharedSource(t, func(kind string) (ProviderCredential, bool) {
		return ProviderCredential{APIKey: "sk-shared", BaseURL: "https://gw.internal.test"}, true
	})
	user := domain.User{AgentCLICredentials: map[string]domain.AgentCLICredential{
		"pi": {APIKey: "sk-personal", BaseURL: "https://mine.test", Protocol: domain.AgentCLIProtocolChat},
	}}
	got := AgentCLIUserCredentials(user)
	if got["pi"].APIKey != "sk-personal" {
		t.Fatalf("personal key must win, got %q", got["pi"].APIKey)
	}
	if got["pi"].BaseURL != "https://mine.test" {
		t.Fatalf("personal base url must win, got %q", got["pi"].BaseURL)
	}
}

// 个人只填了 BaseURL 没填 Key 时，Key 用共享的，地址仍用个人的。
func TestAgentCLIUserCredentialsPartialPersonalKeepsBaseURL(t *testing.T) {
	withSharedSource(t, func(kind string) (ProviderCredential, bool) {
		return ProviderCredential{APIKey: "sk-shared", BaseURL: "https://gw.internal.test"}, true
	})
	user := domain.User{AgentCLICredentials: map[string]domain.AgentCLICredential{
		"opencode": {BaseURL: "https://my-gateway.test"},
	}}
	got := AgentCLIUserCredentials(user)
	cred := got["opencode"]
	if cred.APIKey != "sk-shared" {
		t.Fatalf("key should come from shared, got %q", cred.APIKey)
	}
	if cred.BaseURL != "https://my-gateway.test" {
		t.Fatalf("personal base url must be preserved, got %q", cred.BaseURL)
	}
}

// 个人已存的模型列表不被共享列表覆盖：那通常来自账号实际可见的模型。
func TestAgentCLIUserCredentialsKeepsPersonalModels(t *testing.T) {
	withSharedSource(t, func(kind string) (ProviderCredential, bool) {
		return ProviderCredential{APIKey: "sk-shared", Models: []domain.CLIModel{{ID: "shared-model"}}}, true
	})
	user := domain.User{AgentCLICredentials: map[string]domain.AgentCLICredential{
		"kimi": {Models: []domain.CLIModel{{ID: "my-model"}}},
	}}
	got := AgentCLIUserCredentials(user)
	if len(got["kimi"].Models) != 1 || got["kimi"].Models[0].ID != "my-model" {
		t.Fatalf("personal models must survive, got %v", got["kimi"].Models)
	}
}

// ResolveProviderCredential 是 Codex / Claude Code 的取值入口。
func TestResolveProviderCredential(t *testing.T) {
	withSharedSource(t, func(kind string) (ProviderCredential, bool) {
		if kind != "codex" {
			return ProviderCredential{}, false
		}
		return ProviderCredential{APIKey: "sk-codex-shared", BaseURL: "https://gw.internal.test"}, true
	})

	// 个人有 Key：完全用个人的
	personal := ResolveProviderCredential("codex", "sk-mine", "https://mine.test")
	if personal.APIKey != "sk-mine" || personal.BaseURL != "https://mine.test" {
		t.Fatalf("personal must win: %+v", personal)
	}

	// 个人没有 Key：用共享的
	shared := ResolveProviderCredential("codex", "", "")
	if shared.APIKey != "sk-codex-shared" || shared.BaseURL != "https://gw.internal.test" {
		t.Fatalf("shared should apply: %+v", shared)
	}

	// 个人只有 BaseURL：Key 用共享的，地址用个人的
	mixed := ResolveProviderCredential("codex", "", "https://mine.test")
	if mixed.APIKey != "sk-codex-shared" || mixed.BaseURL != "https://mine.test" {
		t.Fatalf("base url must stay personal: %+v", mixed)
	}

	// 都没有：返回空凭据，不能伪造一个 Key
	none := ResolveProviderCredential("claude-code", "", "https://mine.test")
	if none.APIKey != "" || none.BaseURL != "https://mine.test" {
		t.Fatalf("no shared source for this provider: %+v", none)
	}
}

// 空 APIKey 的共享配置视为未配置，否则会把空 Key 注入 CLI。
func TestSharedProviderCredentialRejectsEmptyKey(t *testing.T) {
	withSharedSource(t, func(kind string) (ProviderCredential, bool) {
		return ProviderCredential{APIKey: "   ", BaseURL: "https://gw.test"}, true
	})
	if _, ok := SharedProviderCredential("opencode"); ok {
		t.Fatal("blank shared key must not be offered")
	}
}
