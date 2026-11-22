package repo

import (
	"strings"

	"agentflow/internal/domain"
	"agentflow/internal/runtime"
)

// RegisterPlatformProviderCredentials 把平台共享凭据接到 runtime 的查询源。
//
// runtime 不依赖 repo（保持分层），因此在进程启动时由这里注册一个适配器：
// 运行装配时会用「个人优先、共享补齐」的顺序取值。未调用时 runtime 的所有
// 共享查询都返回 false，行为与引入共享凭据之前一致。
//
// 一次注册、进程内缓存：SharedProviderKeys 每次调用都会查库，但只在真正
// 装配运行时发生，频率可控。若将来配置变动需要即时生效，可在此加短 TTL。
func RegisterPlatformProviderCredentials(s *Store) {
	if s == nil {
		return
	}
	runtime.RegisterSharedProviderCredentialSource(func(kind string) (runtime.ProviderCredential, bool) {
		key, ok := s.SharedProviderKey(strings.TrimSpace(kind))
		if !ok {
			return runtime.ProviderCredential{}, false
		}
		models := make([]domain.CLIModel, 0, len(key.Models))
		for _, id := range key.Models {
			models = append(models, domain.CLIModel{ID: id})
		}
		return runtime.ProviderCredential{
			APIKey:   key.APIKey,
			BaseURL:  key.BaseURL,
			Protocol: key.Protocol,
			Models:   models,
		}, true
	})
}
