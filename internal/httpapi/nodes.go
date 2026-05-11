package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

// Routes holds API handlers.
type Routes struct {
	Deps Deps
}

type nodeResponse struct {
	ID         uint   `json:"id"`
	Name       string `json:"name"`
	BaseURL    string `json:"base_url"`
	Username   string `json:"username"`
	AuthKind   string `json:"auth_kind"`
	Online     bool   `json:"online"`
	Version    string `json:"version"`
	LastPingMs int64  `json:"last_ping_ms"`
	LastSyncAt *int64 `json:"last_sync_at,omitempty"`
	Drifted    bool   `json:"drifted"`
	UIURL      string `json:"ui_url"`
	CreatedAt  int64  `json:"created_at"`
	UpdatedAt  int64  `json:"updated_at"`
}

func toNodeResponse(n *models.Node) nodeResponse {
	var lastSync *int64
	if n.LastSyncAt != nil {
		ms := n.LastSyncAt.UnixMilli()
		lastSync = &ms
	}
	return nodeResponse{
		ID:         n.ID,
		Name:       n.Name,
		BaseURL:    n.BaseURL,
		Username:   n.Username,
		AuthKind:   n.AuthKind,
		Online:     n.Online,
		Version:    n.Version,
		LastPingMs: n.LastPingMs,
		LastSyncAt: lastSync,
		Drifted:    n.Drifted,
		UIURL:      models.NormalizeBaseURL(n.BaseURL),
		CreatedAt:  n.CreatedAt.UnixMilli(),
		UpdatedAt:  n.UpdatedAt.UnixMilli(),
	}
}

func parseNodeID(s string) (uint, error) {
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil || v < 1 {
		return 0, err
	}
	return uint(v), nil
}

func (r *Routes) listNodes(c echo.Context) error {
	var nodes []models.Node
	if err := r.Deps.DB.WithContext(c.Request().Context()).Order("id").Find(&nodes).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	out := make([]nodeResponse, 0, len(nodes))
	for i := range nodes {
		out = append(out, toNodeResponse(&nodes[i]))
	}
	return c.JSON(http.StatusOK, out)
}

func (r *Routes) getNode(c echo.Context) error {
	id, err := parseNodeID(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid node id"})
	}
	var n models.Node
	if err := r.Deps.DB.WithContext(c.Request().Context()).First(&n, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "node not found"})
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	return c.JSON(http.StatusOK, toNodeResponse(&n))
}

func (r *Routes) postNode(c echo.Context) error {
	ctx := c.Request().Context()
	var body nodeWriteRequest
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid JSON"})
	}
	if err := validateNodeInput(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": err.Error()})
	}
	n := &models.Node{}
	applyNodeWriteRequest(n, &body)
	if err := r.Deps.DB.WithContext(ctx).Create(n).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	if err := probeAndPersist(ctx, r.Deps.DB, n.ID); err != nil {
		var fresh models.Node
		_ = r.Deps.DB.WithContext(ctx).First(&fresh, n.ID).Error
		return c.JSON(http.StatusUnprocessableEntity, map[string]any{
			"message": err.Error(),
			"node":    toNodeResponse(&fresh),
		})
	}
	var out models.Node
	_ = r.Deps.DB.WithContext(ctx).First(&out, n.ID).Error
	return c.JSON(http.StatusCreated, toNodeResponse(&out))
}

// postNodeProbe runs GET /control/status for one node (Admin), holding AdGHSem like querylog/sync/drift.
// Does not require the node to be online (mis-detection recovery). Node must exist (404 otherwise).
func (r *Routes) postNodeProbe(c echo.Context) error {
	ctx := c.Request().Context()
	id, err := parseNodeID(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid node id"})
	}
	if err := r.Deps.DB.WithContext(ctx).First(&models.Node{}, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "node not found"})
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	if err := acquire(ctx, r.Deps.AdGHSem); err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"message": err.Error()})
	}
	defer release(r.Deps.AdGHSem)
	if err := probeAndPersist(ctx, r.Deps.DB, id); err != nil {
		var fresh models.Node
		_ = r.Deps.DB.WithContext(ctx).First(&fresh, id).Error
		return c.JSON(http.StatusUnprocessableEntity, map[string]any{
			"message": err.Error(),
			"node":    toNodeResponse(&fresh),
		})
	}
	var out models.Node
	_ = r.Deps.DB.WithContext(ctx).First(&out, id).Error
	return c.JSON(http.StatusOK, toNodeResponse(&out))
}

func (r *Routes) patchNode(c echo.Context) error {
	ctx := c.Request().Context()
	id, err := parseNodeID(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid node id"})
	}
	var n models.Node
	if err := r.Deps.DB.WithContext(ctx).First(&n, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"message": "node not found"})
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	var body nodeWriteRequest
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid JSON"})
	}
	if err := validateNodeInput(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": err.Error()})
	}
	applyNodeWriteRequest(&n, &body)
	if err := r.Deps.DB.WithContext(ctx).Save(&n).Error; err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	if err := probeAndPersist(ctx, r.Deps.DB, id); err != nil {
		var fresh models.Node
		_ = r.Deps.DB.WithContext(ctx).First(&fresh, id).Error
		return c.JSON(http.StatusUnprocessableEntity, map[string]any{
			"message": err.Error(),
			"node":    toNodeResponse(&fresh),
		})
	}
	var out models.Node
	_ = r.Deps.DB.WithContext(ctx).First(&out, id).Error
	return c.JSON(http.StatusOK, toNodeResponse(&out))
}

func (r *Routes) deleteNode(c echo.Context) error {
	id, err := parseNodeID(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid node id"})
	}
	res := r.Deps.DB.WithContext(c.Request().Context()).Delete(&models.Node{}, id)
	if res.Error != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}
	if res.RowsAffected == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"message": "node not found"})
	}
	return c.NoContent(http.StatusNoContent)
}
