package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/lensdns/dnsfleet/internal/adguard"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

const (
	queryLogRESTDefaultLimit = 20
	queryLogRESTMaxLimit     = 100
)

func mapAdguardQueryLogUpstreamErr(c echo.Context, err error) error {
	msg := err.Error()
	switch {
	case adguard.IsHTTPUnauthorized(err), adguard.IsHTTPForbidden(err):
		msg = "upstream AdGuard Home rejected the query log request (check node credentials)"
	default:
		if code := adguard.HTTPStatusCode(err); code != 0 {
			msg = fmt.Sprintf("upstream returned HTTP %d", code)
		}
	}
	return c.JSON(http.StatusBadGateway, map[string]string{"message": msg})
}

// getNodeQueryLog proxies GET /control/querylog for one node (Admin).
// Query: older_than (optional), offset (must be 0), limit (default 20, max 100),
// response_status (default all), search (optional, passed through when non-empty).
func (r *Routes) getNodeQueryLog(c echo.Context) error {
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
	if !n.Online {
		return c.JSON(http.StatusUnprocessableEntity, map[string]string{"message": "node is offline"})
	}

	offset := 0
	if q := c.QueryParam("offset"); q != "" {
		o, err := strconv.Atoi(q)
		if err != nil || o < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid offset"})
		}
		if o != 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "offset must be 0"})
		}
		offset = o
	}

	limit := queryLogRESTDefaultLimit
	if q := c.QueryParam("limit"); q != "" {
		l, err := strconv.Atoi(q)
		if err != nil || l < 1 {
			return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid limit"})
		}
		limit = l
	}
	if limit > queryLogRESTMaxLimit {
		limit = queryLogRESTMaxLimit
	}

	olderThan := c.QueryParam("older_than")
	responseStatus := c.QueryParam("response_status")
	search := c.QueryParam("search")

	if err := acquire(ctx, r.Deps.AdGHSem); err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"message": err.Error()})
	}
	defer release(r.Deps.AdGHSem)

	cl, err := adguardClientFor(&n)
	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, map[string]string{"message": err.Error()})
	}

	ql, err := cl.GetQueryLog(ctx, olderThan, offset, limit, responseStatus, search)
	if err != nil {
		return mapAdguardQueryLogUpstreamErr(c, err)
	}
	return c.JSON(http.StatusOK, ql)
}
