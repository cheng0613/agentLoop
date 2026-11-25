package repo

import (
	"agentflow/internal/domain"
)

// RecordAssistantToolCall 写入一条工具调用审计。失败由调用方决定是否忽略：
// 审计不能阻断业务动作。
func (r *AssistantRepo) RecordAssistantToolCall(call domain.AssistantToolCall) error {
	if r == nil || r.DB == nil {
		return nil
	}
	if call.ID == 0 {
		call.ID = 0 // 交给自增主键
	}
	return r.DB.Create(&call).Error
}

// RecentAssistantToolCalls 按时间倒序返回最近的调用记录，供排查与页面展示。
func (r *AssistantRepo) RecentAssistantToolCalls(projectID string, limit int) []domain.AssistantToolCall {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	query := r.DB.Order("at desc").Limit(limit)
	if projectID != "" {
		query = query.Where("project_id = ?", projectID)
	}
	var rows []domain.AssistantToolCall
	if err := query.Find(&rows).Error; err != nil {
		return nil
	}
	return rows
}
