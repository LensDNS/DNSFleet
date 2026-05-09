package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

type globalResponse struct {
	Upstream string          `json:"upstream"`
	Rewrite  json.RawMessage `json:"rewrite"`
}

type globalPutRequest struct {
	Upstream string          `json:"upstream"`
	Rewrite  json.RawMessage `json:"rewrite"`
}

func loadGlobalRow(ctx context.Context, db *gorm.DB, typ string) (models.GlobalConfig, bool, error) {
	var row models.GlobalConfig
	err := db.WithContext(ctx).Where("type = ?", typ).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.GlobalConfig{}, false, nil
	}
	if err != nil {
		return models.GlobalConfig{}, false, err
	}
	return row, true, nil
}

func upsertGlobalContent(ctx context.Context, db *gorm.DB, typ, content string) error {
	var row models.GlobalConfig
	err := db.WithContext(ctx).Where("type = ?", typ).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.WithContext(ctx).Create(&models.GlobalConfig{
			Type:    typ,
			Content: content,
		}).Error
	}
	if err != nil {
		return err
	}
	row.Content = content
	return db.WithContext(ctx).Save(&row).Error
}

func (r *Routes) getGlobal(c echo.Context) error {
	ctx := c.Request().Context()
	upRow, upOk, err := loadGlobalRow(ctx, r.Deps.DB, models.GlobalConfigTypeUpstream)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	rwRow, rwOk, err := loadGlobalRow(ctx, r.Deps.DB, models.GlobalConfigTypeRewrite)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	upstream := ""
	if upOk {
		upstream = upRow.Content
	}
	var rewriteJSON json.RawMessage
	if !rwOk || strings.TrimSpace(rwRow.Content) == "" {
		rewriteJSON = json.RawMessage("[]")
	} else {
		list, err := parseRewriteListJSON([]byte(rwRow.Content))
		if err != nil {
			rewriteJSON = json.RawMessage("[]")
		} else {
			b, err := json.Marshal(list)
			if err != nil {
				rewriteJSON = json.RawMessage("[]")
			} else {
				rewriteJSON = b
			}
		}
	}
	return c.JSON(http.StatusOK, globalResponse{Upstream: upstream, Rewrite: rewriteJSON})
}

func (r *Routes) putGlobal(c echo.Context) error {
	var body globalPutRequest
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid JSON"})
	}
	if len(body.Rewrite) == 0 {
		body.Rewrite = json.RawMessage("[]")
	}
	list, err := parseRewriteListJSON(body.Rewrite)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "rewrite must be a JSON array"})
	}
	rewBytes, err := json.Marshal(list)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "encode rewrite")
	}
	up := strings.TrimSpace(body.Upstream)
	ctx := c.Request().Context()
	if err := upsertGlobalContent(ctx, r.Deps.DB, models.GlobalConfigTypeUpstream, up); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	if err := upsertGlobalContent(ctx, r.Deps.DB, models.GlobalConfigTypeRewrite, string(rewBytes)); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	return r.getGlobal(c)
}
