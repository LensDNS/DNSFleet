package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

// loadGlobalUpstreamRewrite returns DB-backed global upstream text and rewrite JSON bytes (for AdGH apply / drift compare).
func loadGlobalUpstreamRewrite(ctx context.Context, db *gorm.DB) (upstream string, rewriteJSON []byte, err error) {
	var upRow models.GlobalConfig
	upErr := db.WithContext(ctx).Where("type = ?", models.GlobalConfigTypeUpstream).First(&upRow).Error
	if upErr == nil {
		upstream = upRow.Content
	} else if !errors.Is(upErr, gorm.ErrRecordNotFound) {
		return "", nil, upErr
	}
	var rwRow models.GlobalConfig
	rwErr := db.WithContext(ctx).Where("type = ?", models.GlobalConfigTypeRewrite).First(&rwRow).Error
	if errors.Is(rwErr, gorm.ErrRecordNotFound) || (rwErr == nil && strings.TrimSpace(rwRow.Content) == "") {
		b, _ := json.Marshal([]any{})
		return upstream, b, nil
	}
	if rwErr != nil && !errors.Is(rwErr, gorm.ErrRecordNotFound) {
		return "", nil, rwErr
	}
	list, perr := parseRewriteListJSON([]byte(rwRow.Content))
	if perr != nil {
		b, _ := json.Marshal([]any{})
		return upstream, b, nil
	}
	b, merr := json.Marshal(list)
	if merr != nil {
		b, _ := json.Marshal([]any{})
		return upstream, b, nil
	}
	return upstream, b, nil
}
