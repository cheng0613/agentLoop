package domain

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// PlatformProviderKey 是一个 Agent CLI 的平台级共享凭据。
//
// 团队部署时由管理员在「平台管理」统一配置一次，成员无需各自填写。
// 个人凭据仍然优先：用户自己保存的 Key 会覆盖这里的配置。
//
// 一个 provider 对应一个 Agent CLI（codebuddy / codex / claude-code /
// opencode / kimi / pi / dsh / zcode / agy）。空 BaseURL 表示该 CLI 的官方
// 端点；自建统一网关时把所有 CLI 指向同一个地址即可。
type PlatformProviderKey struct {
	Provider string `json:"provider"`
	// APIKey 永不序列化到响应里，只由管理员写入。
	APIKey string `json:"-"`
	// BaseURL 为空表示官方端点。指向统一网关时通常是同一个地址。
	BaseURL string `json:"baseUrl,omitempty"`
	// Protocol 是 BaseURL 使用的协议（AgentCLIProtocolChat 等）。为空时按
	// 该 provider 的第一个受支持协议处理，见 NormalizeAgentCLIProtocol。
	Protocol string `json:"protocol,omitempty"`
	// Models 是这个共享 Key 允许使用的模型，第一个曾用作默认。
	// DefaultModel 显式指定默认模型，未指定时取 Models[0]。
	Models       []string   `json:"models"`
	DefaultModel string     `json:"defaultModel,omitempty"`
	Enabled      bool       `json:"enabled"`
	UpdatedBy    string     `json:"updatedBy,omitempty"`
	UpdatedAt    *time.Time `json:"updatedAt,omitempty"`
}

// PlatformProviderKeyStatus 是管理员看到的配置状态，不含 Key 原文。
type PlatformProviderKeyStatus struct {
	Provider     string     `json:"provider"`
	Label        string     `json:"label"`
	Configured   bool       `json:"configured"`
	Enabled      bool       `json:"enabled"`
	APIKeyMask   string     `json:"apiKeyMask,omitempty"`
	BaseURL      string     `json:"baseUrl,omitempty"`
	Protocol     string     `json:"protocol,omitempty"`
	Protocols    []string   `json:"protocols,omitempty"`
	Models       []string   `json:"models"`
	DefaultModel string     `json:"defaultModel,omitempty"`
	UpdatedBy    string     `json:"updatedBy,omitempty"`
	UpdatedAt    *time.Time `json:"updatedAt,omitempty"`
}

// PlatformProviderKeyUpdate replaces one provider's shared configuration.
// An empty APIKey keeps the stored key, so an administrator can change the
// gateway URL or model list without re-entering the secret.
type PlatformProviderKeyUpdate struct {
	Provider     string
	APIKey       string
	BaseURL      string
	Protocol     string
	Models       []string
	DefaultModel string
	Enabled      *bool
}

// MaskAPIKey 只保留首尾少量字符，用于管理员确认「是否已配置」以及辨认是哪一把。
// 少于 12 个字符的 Key 一律完全遮蔽，避免掩码反而泄露内容。
func MaskAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	if len(key) < 12 {
		return strings.Repeat("•", len(key))
	}
	return key[:4] + strings.Repeat("•", 8) + key[len(key)-4:]
}

// validProviderBaseURL 与 httpapi.validCLIBaseURL 同规：接受 HTTP(S) 服务地址，
// 不接受内嵌账号密码、查询参数或片段。空值由调用方处理（表示官方端点）。
func validProviderBaseURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") &&
		u.Hostname() != "" && u.User == nil && u.RawQuery == "" &&
		u.Fragment == "" && len(raw) <= 2048
}

// ErrPlatformProviderKeyUnsupported 表示该 provider 不能配置共享凭据。
var ErrPlatformProviderKeyUnsupported = fmt.Errorf("unsupported platform provider")

// ValidatePlatformProviderKeyUpdate 校验一次配置写入。
// cliKinds 是可配置的 provider 列表，由调用方从 runtime 层传入，避免
// domain 反向依赖 runtime。
func ValidatePlatformProviderKeyUpdate(update PlatformProviderKeyUpdate, cliKinds []string, protocolsFor func(kind string) []string) error {
	provider := strings.TrimSpace(update.Provider)
	if provider == "" {
		return fmt.Errorf("provider 不能为空")
	}
	known := false
	for _, kind := range cliKinds {
		if kind == provider {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("%w: %s", ErrPlatformProviderKeyUnsupported, provider)
	}

	// BaseURL 为空表示官方端点，这是合法配置。
	if raw := strings.TrimSpace(update.BaseURL); raw != "" {
		if !validProviderBaseURL(raw) {
			return fmt.Errorf("Base URL 必须为 HTTP(S) 服务地址，不能包含账号密码、查询参数或片段")
		}
	}

	// 只有提供 BaseURL 时协议才有意义；未指定则用该 CLI 的默认协议。
	if strings.TrimSpace(update.Protocol) != "" {
		allowed := protocolsFor(provider)
		matched := false
		for _, option := range allowed {
			if option == strings.TrimSpace(update.Protocol) {
				matched = true
				break
			}
		}
		if !matched {
			if len(allowed) == 0 {
				return fmt.Errorf("%s 不支持自定义协议", provider)
			}
			return fmt.Errorf("%s 不支持的协议 %q，可选：%s", provider, update.Protocol, strings.Join(allowed, "、"))
		}
	}

	models := make([]string, 0, len(update.Models))
	for _, model := range update.Models {
		if trimmed := strings.TrimSpace(model); trimmed != "" {
			models = append(models, trimmed)
		}
	}
	if len(models) == 0 {
		return fmt.Errorf("至少需要一个模型")
	}

	if def := strings.TrimSpace(update.DefaultModel); def != "" {
		found := false
		for _, model := range models {
			if model == def {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("默认模型 %q 不在模型列表中", def)
		}
	}
	return nil
}

// DefaultModelOrFirst 返回显式默认模型，否则模型列表的第一项。
func (k PlatformProviderKey) DefaultModelOrFirst() string {
	if def := strings.TrimSpace(k.DefaultModel); def != "" {
		return def
	}
	if len(k.Models) > 0 {
		return k.Models[0]
	}
	return ""
}

// Model 决定一次运行实际使用的模型：请求的模型在允许列表内就用它，
// 否则退回默认模型。返回的 bool 表示请求是否被采纳，调用方据此记录
// 「角色配置的模型不生效」这类事件。
func (k PlatformProviderKey) Model(requested string) (string, bool) {
	if len(k.Models) == 0 {
		return "", false
	}
	requested = strings.TrimSpace(requested)
	if requested != "" {
		for _, model := range k.Models {
			if model == requested {
				return requested, true
			}
		}
	}
	return k.DefaultModelOrFirst(), false
}
