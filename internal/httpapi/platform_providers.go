package httpapi

import (
	"net/http"
	"strings"

	"agentflow/internal/domain"
	"agentflow/internal/repo"
	"agentflow/internal/runtime"

	"github.com/gin-gonic/gin"
)

// 平台共享凭据的按 provider 管理。
//
// 背景：团队部署通常自建统一 API 网关，成员不各自填写模型 Key。管理员在
// 「平台管理」为每个 CLI 配一次 Key/BaseURL/模型，成员直接使用；个人凭据
// 仍然优先，行为与 CodeBuddy 的既有共享机制一致。
//
// 旧的 /api/platform/codebuddy-key 保留可用（内部转发到新表），避免已有前端
// 与脚本失效。

// platformProviderKinds 返回可配置的 provider 清单，顺序即界面展示顺序。
// CodeBuddy / Codex / Claude Code 在 AgentCLIExecutorKinds 之外，需单独补齐。
func platformProviderKinds() []string {
	// 三大件不在 AgentCLIExecutorKinds 里，需单独补齐。
	return append([]string{"codebuddy", "codex", "claude-code"}, domain.AgentCLIExecutorKinds...)
}

// platformProviderProtocols 返回该 CLI 在自建 BaseURL 下可选的协议。
// Codex / Claude Code / Cursor 没有协议选择：它们只讲一种协议，或者
// 只连官方端点，所以返回空列表。
func platformProviderProtocols(kind string) []string {
	return domain.AgentCLIProtocolOptions[strings.TrimSpace(kind)]
}

func (h *usersHandlers) platformProviders(c *gin.Context) {
	if !h.isPlatformAdmin(c.Request) {
		c.JSON(http.StatusForbidden, gin.H{"error": "只有平台管理员可以查看共享凭据"})
		return
	}
	if h.repo == nil {
		c.JSON(http.StatusOK, []domain.PlatformProviderKeyStatus{})
		return
	}
	stored := h.repo.PlatformProviderKeyStatuses()
	out := make([]domain.PlatformProviderKeyStatus, 0, len(platformProviderKinds()))
	// 已配置的 provider 排在前面，其余按固定清单补齐空状态。
	for _, kind := range platformProviderKinds() {
		status, ok := stored[kind]
		if !ok {
			status = domain.PlatformProviderKeyStatus{Provider: kind, Models: []string{}}
		}
		status.Label = runtime.AgentCLILabel(kind)
		status.Protocols = platformProviderProtocols(kind)
		if status.Models == nil {
			status.Models = []string{}
		}
		out = append(out, status)
	}
	c.JSON(http.StatusOK, out)
}

func (h *usersHandlers) platformProvider(c *gin.Context) {
	if !h.platformAdminWrite(c) {
		return
	}
	provider := strings.TrimSpace(c.Param("provider"))
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 provider"})
		return
	}
	if h.repo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "存储不可用"})
		return
	}

	switch c.Request.Method {
	case http.MethodPut:
		h.savePlatformProvider(c, provider)
	case http.MethodDelete:
		if err := h.repo.DeletePlatformProviderKey(provider); err != nil {
			if err == repo.ErrPlatformProviderKeyNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "该 provider 还没有配置"})
				return
			}
			respond(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	default:
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
	}
}

func (h *usersHandlers) savePlatformProvider(c *gin.Context, provider string) {
	var body struct {
		APIKey       string   `json:"apiKey"`
		BaseURL      string   `json:"baseUrl"`
		Protocol     string   `json:"protocol"`
		Models       []string `json:"models"`
		DefaultModel string   `json:"defaultModel"`
		Enabled      *bool    `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求体格式不正确"})
		return
	}

	update := domain.PlatformProviderKeyUpdate{
		Provider:     provider,
		APIKey:       body.APIKey,
		BaseURL:      body.BaseURL,
		Protocol:     body.Protocol,
		Models:       body.Models,
		DefaultModel: body.DefaultModel,
		Enabled:      body.Enabled,
	}
	if err := domain.ValidatePlatformProviderKeyUpdate(update, platformProviderKinds(), platformProviderProtocols); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var actorID int64
	if current, ok := h.requestUser(c.Request, true); ok {
		actorID = current.ID
	}
	if err := h.repo.SetPlatformProviderKey(update, actorID); err != nil {
		respond(c, err)
		return
	}
	// 回读状态，不回显 Key 原文。
	if stored := h.repo.PlatformProviderKeyStatuses(); stored != nil {
		if status, ok := stored[provider]; ok {
			status.Label = runtime.AgentCLILabel(provider)
			status.Protocols = platformProviderProtocols(provider)
			c.JSON(http.StatusOK, status)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// platformProviderProbe 用已保存的共享凭据做一次连通性检查。
//
// 统一网关最常见的问题是沙箱到网关不可达，或协议选错导致 400。这个端点让
// 管理员在把配置下发到团队前先确认「这把 Key 能不能用这个地址调通」。
// 只做一次最小请求，不落库、不记录 token。
func (h *usersHandlers) platformProviderProbe(c *gin.Context) {
	if !h.platformAdminWrite(c) {
		return
	}
	provider := strings.TrimSpace(c.Param("provider"))
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 provider"})
		return
	}
	if h.repo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "存储不可用"})
		return
	}
	key, ok := h.repo.SharedProviderKey(provider)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "该 provider 还没有可用的共享配置"})
		return
	}
	result := runtime.ProbeProviderCredential(c.Request.Context(), provider, runtime.ProviderCredential{
		APIKey:   key.APIKey,
		BaseURL:  key.BaseURL,
		Protocol: key.Protocol,
	})
	status := http.StatusOK
	if !result.OK {
		status = http.StatusBadGateway
	}
	c.JSON(status, result)
}
