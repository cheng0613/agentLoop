package repo

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"agentflow/internal/domain"

	"gorm.io/gorm/clause"
)

// platform_provider_keys 存平台级共享凭据，按 provider 一行。
//
// 这张表取代了 platform_codebuddy_keys 的单行模型：CodeBuddy 只是其中一行。
// 旧表保留一个版本周期用于回滚，读取时仍会兜底（见 SharedCodeBuddyKey）。
type platformProviderKeyRow struct {
	Provider     string     `gorm:"column:provider;primaryKey;size:64"`
	APIKey       string     `gorm:"column:api_key;type:text;not null"`
	BaseURL      string     `gorm:"column:base_url;type:text;not null;default:''"`
	Protocol     string     `gorm:"column:protocol;size:32;not null;default:''"`
	Models       string     `gorm:"column:models;type:text;not null"`
	DefaultModel string     `gorm:"column:default_model;size:191;not null;default:''"`
	Enabled      *bool      `gorm:"column:enabled;not null;default:true"`
	UpdatedBy    int64      `gorm:"column:updated_by;not null;default:0"`
	Updated      *time.Time `gorm:"column:updated_at"`
}

func (platformProviderKeyRow) TableName() string { return "platform_provider_keys" }

var ErrPlatformProviderKeyNotFound = errors.New("platform provider key not found")

// SharedProviderKey 返回某个 provider 的共享凭据。只有启用且 Key 非空时
// 才算配置完成，否则返回 false，调用方回退到官方端点或报缺凭据。
func (r *UsersRepo) SharedProviderKey(provider string) (domain.PlatformProviderKey, bool) {
	provider = strings.TrimSpace(provider)
	if r == nil || r.deps == nil || r.DB == nil || provider == "" {
		return domain.PlatformProviderKey{}, false
	}
	var row platformProviderKeyRow
	result := r.DB.Where("provider = ?", provider).Limit(1).Find(&row)
	if result.Error != nil || result.RowsAffected == 0 {
		return domain.PlatformProviderKey{}, false
	}
	key := domain.PlatformProviderKey{
		Provider:     row.Provider,
		APIKey:       row.APIKey,
		BaseURL:      row.BaseURL,
		Protocol:     row.Protocol,
		Models:       decodeSharedModels(row.Models),
		DefaultModel: row.DefaultModel,
		Enabled:      row.Enabled != nil && *row.Enabled,
		UpdatedAt:    row.Updated,
	}
	if !key.Enabled || strings.TrimSpace(key.APIKey) == "" || len(key.Models) == 0 {
		return domain.PlatformProviderKey{}, false
	}
	if user, ok := r.User(row.UpdatedBy); ok {
		key.UpdatedBy = user.LoginName
	}
	return key, true
}

// SharedProviderKeys 一次取出全部已启用的共享凭据，供运行装配时批量补齐。
// 避免对每个 CLI 各查一次库。
func (r *UsersRepo) SharedProviderKeys() map[string]domain.PlatformProviderKey {
	out := map[string]domain.PlatformProviderKey{}
	if r == nil || r.deps == nil || r.DB == nil {
		return out
	}
	var rows []platformProviderKeyRow
	if result := r.DB.Where("enabled = ?", true).Find(&rows); result.Error != nil {
		return out
	}
	for _, row := range rows {
		key := domain.PlatformProviderKey{
			Provider:     row.Provider,
			APIKey:       row.APIKey,
			BaseURL:      row.BaseURL,
			Protocol:     row.Protocol,
			Models:       decodeSharedModels(row.Models),
			DefaultModel: row.DefaultModel,
			Enabled:      row.Enabled != nil && *row.Enabled,
			UpdatedAt:    row.Updated,
		}
		if strings.TrimSpace(key.APIKey) == "" || len(key.Models) == 0 {
			continue
		}
		out[key.Provider] = key
	}
	return out
}

// SetPlatformProviderKey 保存某个 provider 的共享配置。
// 空 APIKey 保留已有密钥，让管理员可以只改网关地址或模型列表。
func (r *UsersRepo) SetPlatformProviderKey(update domain.PlatformProviderKeyUpdate, actorID int64) error {
	provider := strings.TrimSpace(update.Provider)
	if provider == "" {
		return domain.ErrPlatformProviderKeyUnsupported
	}
	var existing platformProviderKeyRow
	result := r.DB.Where("provider = ?", provider).Limit(1).Find(&existing)
	row := platformProviderKeyRow{Provider: provider}
	if result.Error == nil && result.RowsAffected > 0 {
		row = existing
	}

	if key := strings.TrimSpace(update.APIKey); key != "" {
		row.APIKey = key
	}
	if strings.TrimSpace(row.APIKey) == "" {
		return ErrSharedCodeBuddyKeyRequired
	}
	row.BaseURL = strings.TrimSpace(update.BaseURL)
	row.Protocol = strings.TrimSpace(update.Protocol)
	row.DefaultModel = strings.TrimSpace(update.DefaultModel)

	models := make([]string, 0, len(update.Models))
	for _, model := range update.Models {
		if trimmed := strings.TrimSpace(model); trimmed != "" {
			models = append(models, trimmed)
		}
	}
	if len(models) == 0 {
		return ErrSharedCodeBuddyModelsRequired
	}
	encoded, err := json.Marshal(models)
	if err != nil {
		return err
	}
	row.Models = string(encoded)

	enabled := true
	if update.Enabled != nil {
		enabled = *update.Enabled
	}
	row.Enabled = &enabled
	row.UpdatedBy = actorID
	now := time.Now().UTC()
	row.Updated = &now

	// GORM 在 INSERT 与 UPDATE 时都会跳过零值字段，enabled=false 会被静默
	// 丢掉并落回列默认值 1。所以插入用 Select 强制包含所有列，冲突时再显式
	// 列出要覆盖的列。
	return r.DB.
		Select("provider", "api_key", "base_url", "protocol", "models",
			"default_model", "enabled", "updated_by", "updated_at").
		Clauses(clause.OnConflict{
			DoUpdates: clause.AssignmentColumns([]string{
				"api_key", "base_url", "protocol", "models",
				"default_model", "enabled", "updated_by", "updated_at",
			}),
		}).Create(&row).Error
}

// DeletePlatformProviderKey 清除某个 provider 的共享配置。
func (r *UsersRepo) DeletePlatformProviderKey(provider string) error {
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return ErrPlatformProviderKeyNotFound
	}
	result := r.DB.Where("provider = ?", provider).Delete(&platformProviderKeyRow{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrPlatformProviderKeyNotFound
	}
	return nil
}

// PlatformProviderKeyStatuses 返回所有已配置 provider 的状态，不含 Key 原文。
// 未配置的 provider 不出现在结果里，由调用方按可配置清单补齐空状态。
func (r *UsersRepo) PlatformProviderKeyStatuses() map[string]domain.PlatformProviderKeyStatus {
	out := map[string]domain.PlatformProviderKeyStatus{}
	if r == nil || r.deps == nil || r.DB == nil {
		return out
	}
	var rows []platformProviderKeyRow
	if result := r.DB.Find(&rows); result.Error != nil {
		return out
	}
	for _, row := range rows {
		status := domain.PlatformProviderKeyStatus{
			Provider:     row.Provider,
			Configured:   strings.TrimSpace(row.APIKey) != "",
			Enabled:      row.Enabled != nil && *row.Enabled,
			APIKeyMask:   domain.MaskAPIKey(row.APIKey),
			BaseURL:      row.BaseURL,
			Protocol:     row.Protocol,
			Models:       decodeSharedModels(row.Models),
			DefaultModel: row.DefaultModel,
			UpdatedAt:    row.Updated,
		}
		if user, ok := r.User(row.UpdatedBy); ok {
			status.UpdatedBy = user.LoginName
		}
		out[row.Provider] = status
	}
	return out
}
