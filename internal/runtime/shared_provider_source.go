package runtime

import (
	"strings"
	"sync"

	"agentflow/internal/domain"
)

// 平台共享凭据的进程级来源。
//
// 团队部署使用统一 API 网关时，成员不各自填写模型 Key：管理员在「平台管理」
// 为每个 CLI 配一次，运行装配时按「个人优先、共享补齐」取值。
//
// runtime 不依赖 repo（保持分层），因此在进程启动时由一个 Adapter 注册进来，
// 与 RegisterExtraCredentialSource 是同一套思路。未注册时所有查询都返回
// false，行为与引入共享凭据之前完全一致。
type SharedProviderCredentialSource func(kind string) (ProviderCredential, bool)

var (
	sharedProviderMu     sync.RWMutex
	sharedProviderSource SharedProviderCredentialSource
)

// RegisterSharedProviderCredentialSource 注册平台共享凭据来源。
// 只应在进程启动时调用一次；后注册的覆盖先注册的。
func RegisterSharedProviderCredentialSource(src SharedProviderCredentialSource) {
	sharedProviderMu.Lock()
	defer sharedProviderMu.Unlock()
	sharedProviderSource = src
}

// SharedProviderCredential 返回某个 CLI 的平台共享凭据。
func SharedProviderCredential(kind string) (ProviderCredential, bool) {
	sharedProviderMu.RLock()
	src := sharedProviderSource
	sharedProviderMu.RUnlock()
	if src == nil {
		return ProviderCredential{}, false
	}
	cred, ok := src(strings.TrimSpace(kind))
	if !ok || strings.TrimSpace(cred.APIKey) == "" {
		return ProviderCredential{}, false
	}
	return cred, true
}

// SharedProviderCredentials 是 AgentCLIUserCredentials 直接可用的查询函数。
// 未注册来源时返回 nil，让调用方走「不使用共享凭据」的分支。
func SharedProviderCredentials() func(kind string) (ProviderCredential, bool) {
	sharedProviderMu.RLock()
	registered := sharedProviderSource != nil
	sharedProviderMu.RUnlock()
	if !registered {
		return nil
	}
	return SharedProviderCredential
}

// WithSharedProviderCredentials 返回补齐了平台共享凭据的 user 副本。
//
// 用于在调用链深处（拿不到 *repo.Store 的门面函数）复用同一份凭据解析：
// 只填 Codex / Claude Code 这两个独立字段和 AgentCLICredentials 里缺 Key 的
// CLI，已有的个人配置一律保留。
func WithSharedProviderCredentials(user domain.User) domain.User {
	if SharedProviderCredentials() == nil {
		return user
	}
	if strings.TrimSpace(user.CodexAPIKey) == "" {
		if cred, ok := SharedProviderCredential("codex"); ok {
			user.CodexAPIKey = cred.APIKey
			if strings.TrimSpace(user.CodexBaseURL) == "" {
				user.CodexBaseURL = cred.BaseURL
			}
		}
	}
	if strings.TrimSpace(user.ClaudeCodeAPIKey) == "" {
		if cred, ok := SharedProviderCredential("claude-code"); ok {
			user.ClaudeCodeAPIKey = cred.APIKey
			if strings.TrimSpace(user.ClaudeCodeBaseURL) == "" {
				user.ClaudeCodeBaseURL = cred.BaseURL
			}
		}
	}
	return user
}

// ResolveProviderCredential 按「个人优先、共享补齐」取一个 CLI 的凭据。
// 用于 Codex / Claude Code 这类不走 AgentCLICredentials 映射的 provider。
// 个人填了 Key 就完全用个人的；只填了 BaseURL 时以个人地址为准。
func ResolveProviderCredential(kind, personalKey, personalBaseURL string) ProviderCredential {
	if strings.TrimSpace(personalKey) != "" {
		return ProviderCredential{APIKey: personalKey, BaseURL: personalBaseURL}
	}
	if shared, ok := SharedProviderCredential(kind); ok {
		if strings.TrimSpace(personalBaseURL) != "" {
			shared.BaseURL = personalBaseURL
		}
		return shared
	}
	return ProviderCredential{BaseURL: personalBaseURL}
}
