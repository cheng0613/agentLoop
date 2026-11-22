package repo

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"agentflow/internal/domain"

	"gorm.io/gorm/clause"
)

// Users who have not configured their own CodeBuddy API Key use the shared
// key a platform administrator configured under 平台管理, limited to the
// models the administrator allowed. It covers chat conversations and SOP
// runs, so a new user can start working before configuring anything;
// scheduled prompts, reports, bots and run evaluation keep requiring the
// user's own key.
//
// Older deployments lent the key of the account named by
// AGENTFLOW_ASSISTANT_SPONSOR_LOGIN instead, limited to
// SponsoredCodeBuddyModel. That still applies while no shared key is
// configured.
const (
	CodeBuddySponsorLoginEnv = "AGENTFLOW_ASSISTANT_SPONSOR_LOGIN"
	SponsoredCodeBuddyModel  = "deepseek-v4.1-flash"
	// MaxSharedCodeBuddyModels bounds the allow list of the shared key.
	MaxSharedCodeBuddyModels = 32
)

// SharedCodeBuddyKey is the key users without their own borrow.
type SharedCodeBuddyKey struct {
	APIKey              string
	InternetEnvironment string
	// Models are the models it may run; the first is the default.
	Models []string
	// BaseURL 非空时指向自建网关，为空表示 CodeBuddy 官方端点。
	BaseURL string
	// Protocol 是 BaseURL 使用的协议；为空由 CLI 默认处理。
	Protocol string
	// SponsorID is the lending account under AGENTFLOW_ASSISTANT_SPONSOR_LOGIN,
	// 0 for the key configured under 平台管理.
	SponsorID int64
}

// Model returns the model a shared-key turn runs: the requested model when it
// is allowed, the default when none is requested, and false otherwise.
func (k SharedCodeBuddyKey) Model(requested string) (string, bool) {
	if len(k.Models) == 0 {
		return "", false
	}
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return k.Models[0], true
	}
	for _, id := range k.Models {
		if id == requested {
			return id, true
		}
	}
	return "", false
}

// The key is stored like personal CodeBuddy keys in user_configs: the
// database is the trust boundary, and the key is never returned by the API.
type platformCodeBuddyKeyRow struct {
	ID                  int64      `gorm:"column:id;primaryKey;autoIncrement:false"`
	APIKey              string     `gorm:"column:api_key;type:text;not null"`
	InternetEnvironment string     `gorm:"column:internet_environment;size:64;not null;default:''"`
	Models              string     `gorm:"column:models;type:text;not null"`
	UpdatedBy           int64      `gorm:"column:updated_by;not null;default:0"`
	Updated             *time.Time `gorm:"column:updated_at"`
}

func (platformCodeBuddyKeyRow) TableName() string { return "platform_codebuddy_keys" }

// The table holds at most this one row.
const platformCodeBuddyKeyID = 1

// PlatformCodeBuddyKeyStatus is what administrators see; it never carries the key.
type PlatformCodeBuddyKeyStatus struct {
	Configured          bool       `json:"configured"`
	InternetEnvironment string     `json:"internetEnvironment"`
	Models              []string   `json:"models"`
	UpdatedAt           *time.Time `json:"updatedAt,omitempty"`
	UpdatedBy           string     `json:"updatedBy,omitempty"`
	// LegacySponsor is the account named by AGENTFLOW_ASSISTANT_SPONSOR_LOGIN
	// whose key is lent while no shared key is configured here.
	LegacySponsor      string `json:"legacySponsor,omitempty"`
	LegacySponsorModel string `json:"legacySponsorModel,omitempty"`
}

// PlatformCodeBuddyKeyUpdate replaces the shared key settings. An empty
// APIKey keeps the stored key. Models must already be validated.
type PlatformCodeBuddyKeyUpdate struct {
	APIKey              string
	InternetEnvironment string
	Models              []string
}

var (
	ErrSharedCodeBuddyKeyRequired    = errors.New("shared CodeBuddy API Key is required")
	ErrSharedCodeBuddyModelsRequired = errors.New("at least one shared CodeBuddy model is required")
)

func (r *UsersRepo) platformCodeBuddyKey() (platformCodeBuddyKeyRow, bool) {
	var row platformCodeBuddyKeyRow
	if r == nil || r.deps == nil || r.DB == nil {
		return row, false
	}
	result := r.DB.Where("id = ?", platformCodeBuddyKeyID).Limit(1).Find(&row)
	return row, result.Error == nil && result.RowsAffected > 0
}

func decodeSharedModels(raw string) []string {
	var models []string
	if json.Unmarshal([]byte(raw), &models) != nil {
		return nil
	}
	return models
}

// legacyCodeBuddySponsor returns the account named by
// AGENTFLOW_ASSISTANT_SPONSOR_LOGIN, if it exists and has a key.
func (r *UsersRepo) legacyCodeBuddySponsor() (domain.User, bool) {
	login := strings.TrimSpace(os.Getenv(CodeBuddySponsorLoginEnv))
	if login == "" || r == nil {
		return domain.User{}, false
	}
	sponsor, ok := r.UserByLoginName(login)
	if !ok || strings.TrimSpace(sponsor.CodeBuddyAPIKey) == "" {
		return domain.User{}, false
	}
	return sponsor, true
}

// SharedCodeBuddyKey returns the key users without their own borrow: the one
// configured under 平台管理, else the legacy sponsor account's.
//
// 查表顺序：新表 platform_provider_keys 的 codebuddy 行优先，其次旧表
// platform_codebuddy_keys，最后回退到旧版的借用账号。旧表在新表写入后会
// 自然被越过，保留一个版本周期供回滚。
func (r *UsersRepo) SharedCodeBuddyKey() (SharedCodeBuddyKey, bool) {
	if key, ok := r.SharedProviderKey("codebuddy"); ok {
		return SharedCodeBuddyKey{
			APIKey:              key.APIKey,
			InternetEnvironment: r.codeBuddyInternetEnvironment(),
			Models:              key.Models,
			BaseURL:             key.BaseURL,
			Protocol:            key.Protocol,
		}, true
	}
	if row, ok := r.platformCodeBuddyKey(); ok {
		models := decodeSharedModels(row.Models)
		if strings.TrimSpace(row.APIKey) != "" && len(models) > 0 {
			return SharedCodeBuddyKey{APIKey: row.APIKey, InternetEnvironment: row.InternetEnvironment, Models: models}, true
		}
	}
	sponsor, ok := r.legacyCodeBuddySponsor()
	if !ok {
		return SharedCodeBuddyKey{}, false
	}
	return SharedCodeBuddyKey{APIKey: sponsor.CodeBuddyAPIKey, InternetEnvironment: sponsor.CodeBuddyInternetEnvironment, Models: []string{SponsoredCodeBuddyModel}, SponsorID: sponsor.ID}, true
}

// codeBuddyInternetEnvironment 从旧表读取网络环境。新表不存这个字段：
// 统一网关下 CodeBuddy 的环境由 BaseURL 决定，不再靠环境标签区分。
func (r *UsersRepo) codeBuddyInternetEnvironment() string {
	if row, ok := r.platformCodeBuddyKey(); ok {
		return row.InternetEnvironment
	}
	return ""
}

// SharedCodeBuddyModels returns the models users without their own key may
// use, the default first, or nil when there is no shared key.
func (r *UsersRepo) SharedCodeBuddyModels() []string {
	if key, ok := r.SharedCodeBuddyKey(); ok {
		return key.Models
	}
	return nil
}

// PlatformCodeBuddyKeyStatus describes the shared key for administrators.
func (r *UsersRepo) PlatformCodeBuddyKeyStatus() PlatformCodeBuddyKeyStatus {
	status := PlatformCodeBuddyKeyStatus{Models: []string{}}
	if row, ok := r.platformCodeBuddyKey(); ok && strings.TrimSpace(row.APIKey) != "" {
		status.Configured = true
		status.InternetEnvironment = row.InternetEnvironment
		if models := decodeSharedModels(row.Models); models != nil {
			status.Models = models
		}
		status.UpdatedAt = row.Updated
		if user, ok := r.User(row.UpdatedBy); ok {
			status.UpdatedBy = user.LoginName
		}
	}
	if sponsor, ok := r.legacyCodeBuddySponsor(); ok {
		status.LegacySponsor = sponsor.LoginName
		status.LegacySponsorModel = SponsoredCodeBuddyModel
	}
	return status
}

// SetPlatformCodeBuddyKey saves the shared key settings.
func (r *UsersRepo) SetPlatformCodeBuddyKey(update PlatformCodeBuddyKeyUpdate, actorID int64) error {
	if len(update.Models) == 0 {
		return ErrSharedCodeBuddyModelsRequired
	}
	row, _ := r.platformCodeBuddyKey()
	if key := strings.TrimSpace(update.APIKey); key != "" {
		row.APIKey = key
	}
	if strings.TrimSpace(row.APIKey) == "" {
		return ErrSharedCodeBuddyKeyRequired
	}
	models, err := json.Marshal(update.Models)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	row.ID = platformCodeBuddyKeyID
	row.InternetEnvironment = update.InternetEnvironment
	row.Models = string(models)
	row.UpdatedBy = actorID
	row.Updated = &now
	return r.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"api_key", "internet_environment", "models", "updated_by", "updated_at"}),
	}).Create(&row).Error
}

// ClearPlatformCodeBuddyKey removes the shared key; users without their own
// key need one again (or fall back to the legacy sponsor account).
func (r *UsersRepo) ClearPlatformCodeBuddyKey() error {
	return r.DB.Where("id = ?", platformCodeBuddyKeyID).Delete(&platformCodeBuddyKeyRow{}).Error
}
