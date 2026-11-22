package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"agentflow/internal/domain"
)

// ProviderProbeResult 是一次共享凭据连通性检查的结果。
// 只用于管理员在「平台管理」确认配置可用，不进入任何运行记录。
type ProviderProbeResult struct {
	OK         bool   `json:"ok"`
	Provider   string `json:"provider"`
	Endpoint   string `json:"endpoint"`
	Protocol   string `json:"protocol,omitempty"`
	StatusCode int    `json:"statusCode,omitempty"`
	LatencyMS  int64  `json:"latencyMs"`
	// Message 是给人看的一句话结论。
	Message string `json:"message"`
	// Detail 保留网关返回的前几百字节，便于判断是鉴权失败还是协议不对。
	Detail string `json:"detail,omitempty"`
}

const (
	probeTimeout     = 15 * time.Second
	probeMaxDetail   = 400
	probeMaxResponse = 4096
)

// ProbeProviderCredential 用给定凭据向网关发一次最小请求，确认：
//  1. 地址可达（沙箱/平台能否连通自建网关）
//  2. Key 有效
//  3. 协议与网关匹配（chat / responses / messages 的路径与载荷不同）
//
// 不读取也不返回模型输出，只判断 HTTP 状态。空 BaseURL 时返回失败：
// 探活只对自建网关有意义，官方端点由各 CLI 自行处理登录。
func ProbeProviderCredential(ctx context.Context, provider string, cred ProviderCredential) ProviderProbeResult {
	result := ProviderProbeResult{Provider: provider, Protocol: cred.Protocol}
	base := strings.TrimRight(strings.TrimSpace(cred.BaseURL), "/")
	if base == "" {
		result.Message = "未配置 Base URL，探活仅适用于自建网关"
		return result
	}
	if strings.TrimSpace(cred.APIKey) == "" {
		result.Message = "未配置 API Key"
		return result
	}

	protocol := NormalizeAgentCLIProtocolOrDefault(provider, cred.Protocol)
	result.Protocol = protocol
	endpoint, body, authHeader, authValue, err := probeRequest(protocol, base)
	if err != nil {
		result.Message = err.Error()
		return result
	}
	result.Endpoint = endpoint

	payload, err := json.Marshal(body)
	if err != nil {
		result.Message = "构造探活请求失败"
		return result
	}

	reqCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		result.Message = "构造探活请求失败：" + err.Error()
		return result
	}
	req.Header.Set("content-type", "application/json")
	if authHeader != "" {
		req.Header.Set(authHeader, authValue)
	} else {
		req.Header.Set("authorization", "Bearer "+strings.TrimSpace(cred.APIKey))
	}

	started := time.Now()
	resp, err := http.DefaultClient.Do(req)
	result.LatencyMS = time.Since(started).Milliseconds()
	if err != nil {
		result.Message = "无法连接网关，请确认沙箱与执行机能访问该地址：" + trimProbeDetail(err.Error())
		return result
	}
	defer resp.Body.Close()
	result.StatusCode = resp.StatusCode

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, probeMaxResponse))
	result.Detail = trimProbeDetail(string(raw))

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		result.OK = true
		result.Message = fmt.Sprintf("连通正常（%s，%dms）", protocol, result.LatencyMS)
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		result.Message = "网关可达，但凭据被拒绝（401/403），请检查 API Key"
	case resp.StatusCode == http.StatusNotFound:
		result.Message = fmt.Sprintf("网关可达，但 %s 协议路径不存在（404），可能协议选错或网关未开放该接口", protocol)
	case resp.StatusCode == http.StatusBadRequest:
		result.Message = "网关可达，但请求被拒绝（400），通常是协议与网关不匹配"
	default:
		result.Message = fmt.Sprintf("网关返回 %d，请查看返回内容", resp.StatusCode)
	}
	return result
}

// probeRequest 按协议给出探活用的路径与最小载荷。
// 各协议的鉴权方式沿用对应 CLI 的惯例：Anthropic 用 x-api-key，
// OpenAI 系用 Authorization: Bearer。
func probeRequest(protocol, base string) (endpoint string, body map[string]any, authHeader, authValue string, err error) {
	switch protocol {
	case AgentCLIProtocolChat:
		return base + "/chat/completions",
			map[string]any{
				"model":      probeModel,
				"max_tokens": 1,
				"messages":   []map[string]string{{"role": "user", "content": "ping"}},
			}, "", "", nil
	case AgentCLIProtocolResponses:
		return base + "/responses",
			map[string]any{"model": probeModel, "input": "ping", "max_output_tokens": 16},
			"", "", nil
	case AgentCLIProtocolMessages:
		return base + "/messages",
			map[string]any{
				"model":      probeModel,
				"max_tokens": 1,
				"messages":   []map[string]string{{"role": "user", "content": "ping"}},
			}, "x-api-key", "", nil
	case AgentCLIProtocolGemini:
		// Gemini 的原生路径带模型名，探活用最小可用模型。
		return base + "/models/" + probeModel + ":generateContent",
			map[string]any{"contents": []map[string]any{{"parts": []map[string]string{{"text": "ping"}}}}},
			"x-goog-api-key", "", nil
	}
	return "", nil, "", "", fmt.Errorf("不支持的协议 %q", protocol)
}

// probeModel 是探活用的模型名。统一网关通常要求模型存在，这里用一个
// 几乎各网关都会透传的最小名称；若网关校验模型，失败信息会指出这一点。
const probeModel = "gpt-4o-mini"

// NormalizeAgentCLIProtocolOrDefault 返回该 provider 的合法协议；未知值
// 回退到它的首个受支持协议，都没有则用 chat。
func NormalizeAgentCLIProtocolOrDefault(kind, protocol string) string {
	if normalized := domain.NormalizeAgentCLIProtocol(kind, protocol); normalized != "" {
		return normalized
	}
	if options := domain.AgentCLIProtocolOptions[kind]; len(options) > 0 {
		return options[0]
	}
	return AgentCLIProtocolChat
}

func trimProbeDetail(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) <= probeMaxDetail {
		return raw
	}
	return raw[:probeMaxDetail] + "…"
}
