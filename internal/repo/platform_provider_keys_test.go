package repo

import (
	"testing"

	"agentflow/internal/domain"
)

func openProviderStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// 未配置时不能返回「已配置」，否则运行会拿着空 Key 去调模型。
func TestSharedProviderKeyAbsentByDefault(t *testing.T) {
	s := openProviderStore(t)
	if _, ok := s.SharedProviderKey("opencode"); ok {
		t.Fatal("unconfigured provider must not report a shared key")
	}
	if keys := s.SharedProviderKeys(); len(keys) != 0 {
		t.Fatalf("expected no shared keys, got %d", len(keys))
	}
}

// 写入后应能读回，且 BaseURL / 协议 / 模型都保留。
func TestSetAndReadPlatformProviderKey(t *testing.T) {
	s := openProviderStore(t)
	if err := s.SetPlatformProviderKey(domain.PlatformProviderKeyUpdate{
		Provider:     "opencode",
		APIKey:       "sk-gateway-secret",
		BaseURL:      "https://gw.internal.test/v1",
		Protocol:     domain.AgentCLIProtocolResponses,
		Models:       []string{"gpt-4o", "claude-sonnet"},
		DefaultModel: "gpt-4o",
	}, 7); err != nil {
		t.Fatal(err)
	}

	key, ok := s.SharedProviderKey("opencode")
	if !ok {
		t.Fatal("configured provider must be readable")
	}
	if key.APIKey != "sk-gateway-secret" {
		t.Fatalf("api key = %q", key.APIKey)
	}
	if key.BaseURL != "https://gw.internal.test/v1" {
		t.Fatalf("base url = %q", key.BaseURL)
	}
	if key.Protocol != domain.AgentCLIProtocolResponses {
		t.Fatalf("protocol = %q", key.Protocol)
	}
	if len(key.Models) != 2 || key.Models[0] != "gpt-4o" {
		t.Fatalf("models = %v", key.Models)
	}
	if got := key.DefaultModelOrFirst(); got != "gpt-4o" {
		t.Fatalf("default model = %q", got)
	}
}

// 空 APIKey 表示「只改其他字段」，必须保留原密钥。
func TestSetProviderKeyKeepsExistingSecret(t *testing.T) {
	s := openProviderStore(t)
	if err := s.SetPlatformProviderKey(domain.PlatformProviderKeyUpdate{
		Provider: "kimi", APIKey: "sk-original", Models: []string{"m1"},
	}, 1); err != nil {
		t.Fatal(err)
	}
	// 第二次不传 Key，只换网关地址
	if err := s.SetPlatformProviderKey(domain.PlatformProviderKeyUpdate{
		Provider: "kimi", BaseURL: "https://gw2.internal.test", Models: []string{"m2"},
	}, 1); err != nil {
		t.Fatal(err)
	}
	key, ok := s.SharedProviderKey("kimi")
	if !ok {
		t.Fatal("key must survive an update without a secret")
	}
	if key.APIKey != "sk-original" {
		t.Fatalf("secret overwritten: %q", key.APIKey)
	}
	if key.BaseURL != "https://gw2.internal.test" {
		t.Fatalf("base url not updated: %q", key.BaseURL)
	}
	if len(key.Models) != 1 || key.Models[0] != "m2" {
		t.Fatalf("models not updated: %v", key.Models)
	}
}

// 禁用后不再对外提供，但记录仍在（便于重新启用）。
func TestDisabledProviderKeyIsNotOffered(t *testing.T) {
	s := openProviderStore(t)
	disabled := false
	if err := s.SetPlatformProviderKey(domain.PlatformProviderKeyUpdate{
		Provider: "pi", APIKey: "sk-x", Models: []string{"m"}, Enabled: &disabled,
	}, 1); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.SharedProviderKey("pi"); ok {
		t.Fatal("disabled key must not be offered")
	}
	statuses := s.PlatformProviderKeyStatuses()
	status, ok := statuses["pi"]
	if !ok {
		t.Fatal("disabled row should still be listed for administrators")
	}
	if status.Enabled {
		t.Fatal("status must carry enabled=false")
	}
}

// 批量读取只返回可用的（启用 + 有 Key + 有模型）。
func TestSharedProviderKeysBulk(t *testing.T) {
	s := openProviderStore(t)
	for _, u := range []domain.PlatformProviderKeyUpdate{
		{Provider: "opencode", APIKey: "sk-a", Models: []string{"mA"}},
		{Provider: "kimi", APIKey: "sk-b", Models: []string{"mB"}},
	} {
		if err := s.SetPlatformProviderKey(u, 1); err != nil {
			t.Fatal(err)
		}
	}
	keys := s.SharedProviderKeys()
	if len(keys) != 2 {
		t.Fatalf("expected 2 shared keys, got %d", len(keys))
	}
	if keys["opencode"].APIKey != "sk-a" || keys["kimi"].APIKey != "sk-b" {
		t.Fatalf("unexpected keys: %+v", keys)
	}
}

// 管理员视图不能返回 Key 原文，只给掩码。
func TestProviderKeyStatusMasksSecret(t *testing.T) {
	s := openProviderStore(t)
	if err := s.SetPlatformProviderKey(domain.PlatformProviderKeyUpdate{
		Provider: "codex", APIKey: "sk-abcdefghijklmnop", Models: []string{"m"},
	}, 1); err != nil {
		t.Fatal(err)
	}
	status := s.PlatformProviderKeyStatuses()["codex"]
	if !status.Configured {
		t.Fatal("should be configured")
	}
	if status.APIKeyMask == "sk-abcdefghijklmnop" {
		t.Fatal("full secret must never leave the repo layer")
	}
	if status.APIKeyMask == "" {
		t.Fatal("mask should be present so administrators can tell keys apart")
	}
}

// 删除后不再可用，重复删除报 NotFound。
func TestDeletePlatformProviderKey(t *testing.T) {
	s := openProviderStore(t)
	if err := s.SetPlatformProviderKey(domain.PlatformProviderKeyUpdate{
		Provider: "zcode", APIKey: "sk-z", Models: []string{"m"},
	}, 1); err != nil {
		t.Fatal(err)
	}
	if err := s.DeletePlatformProviderKey("zcode"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.SharedProviderKey("zcode"); ok {
		t.Fatal("deleted key must not be readable")
	}
	if err := s.DeletePlatformProviderKey("zcode"); err != ErrPlatformProviderKeyNotFound {
		t.Fatalf("second delete = %v", err)
	}
}

// SharedCodeBuddyKey 必须优先读新表，这样统一网关配置对 CodeBuddy 也生效。
func TestSharedCodeBuddyKeyPrefersProviderTable(t *testing.T) {
	s := openProviderStore(t)
	if err := s.SetPlatformProviderKey(domain.PlatformProviderKeyUpdate{
		Provider:     "codebuddy",
		APIKey:       "sk-cb-new",
		BaseURL:      "https://gw.internal.test",
		Protocol:     domain.AgentCLIProtocolChat,
		Models:       []string{"cb-model"},
		DefaultModel: "cb-model",
	}, 1); err != nil {
		t.Fatal(err)
	}
	key, ok := s.SharedCodeBuddyKey()
	if !ok {
		t.Fatal("shared CodeBuddy key must resolve from the provider table")
	}
	if key.APIKey != "sk-cb-new" {
		t.Fatalf("api key = %q", key.APIKey)
	}
	if key.BaseURL != "https://gw.internal.test" {
		t.Fatalf("base url must flow through for gateway deployments: %q", key.BaseURL)
	}
	if len(key.Models) != 1 || key.Models[0] != "cb-model" {
		t.Fatalf("models = %v", key.Models)
	}
}
