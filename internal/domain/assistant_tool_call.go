package domain

import "time"

// AssistantToolCall 是助手/定时任务通过平台网关调用工具的一条审计记录。
//
// 为什么需要它：门禁放行、SOP 派发这类动作原本无法回答「谁做的、是什么
// 发起的」。会话消息只记「正在调用模型…」，网关不打日志，运行事件也没有
// 操作者。排查一次「模型有没有代批」时三条线索全断，所以把工具调用单独
// 落一张表。
//
// 只记录事实，不记录凭据：Args 已在写入前做过脱敏与截断。
type AssistantToolCall struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	At        time.Time `gorm:"index" json:"at"`
	UserID    int64     `gorm:"index" json:"userId,omitempty"`
	UserName  string    `gorm:"size:128" json:"userName,omitempty"`
	ProjectID string    `gorm:"size:64;index" json:"projectId,omitempty"`
	// SessionID 是普通会话 id；RunID 是 SOP 运行 id。两者都可能为空。
	SessionID string `gorm:"size:64;index" json:"sessionId,omitempty"`
	RunID     string `gorm:"size:64;index" json:"runId,omitempty"`
	Mode      string `gorm:"size:32" json:"mode,omitempty"`
	Tool      string `gorm:"size:64;index" json:"tool"`
	// ReadOnly 标记查询类工具，审计时可以先跳过它们。
	ReadOnly bool `json:"readOnly"`
	// Outcome 取 ok / denied / error 三种：denied 表示被审批模式或审查器拦下。
	Outcome string `gorm:"size:16" json:"outcome"`
	Error   string `gorm:"size:512" json:"error,omitempty"`
	// Args 是脱敏并截断后的参数摘要，用于还原「对什么做了什么」。
	Args string `gorm:"size:1024" json:"args,omitempty"`
}
