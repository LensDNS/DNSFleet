package middleware

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/config"
)

// AdminWS enforces DNSFLEET_ADMIN_TOKEN for WebSocket Upgrade on routes under the /api/v1/ws group
// (v0.1: GET /logs → full path GET /api/v1/ws/logs). The group prefix alone is not a leaf URL.
// Unlike Admin, it accepts Query "token" as an alternative to Authorization Bearer / X-Admin-Token (Step 4 §4.A).
// REST /api/v1 routes must not use this middleware; keep Query "token" off the general Admin path.
func AdminWS(cfg config.Config) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if cfg.AdminInsecureDisable {
				return next(c)
			}

			authz := strings.TrimSpace(c.Request().Header.Get("Authorization"))
			bearer := ""
			const pfx = "Bearer "
			if len(authz) > len(pfx) && strings.EqualFold(authz[:len(pfx)], pfx) {
				bearer = strings.TrimSpace(authz[len(pfx):])
			}
			xTok := strings.TrimSpace(c.Request().Header.Get("X-Admin-Token"))

			if bearer != "" && xTok != "" && bearer != xTok {
				return c.JSON(http.StatusBadRequest, map[string]string{
					"message": "Authorization Bearer token and X-Admin-Token differ",
				})
			}

			headerTok := bearer
			if headerTok == "" {
				headerTok = xTok
			}
			queryTok := strings.TrimSpace(c.QueryParam("token"))

			if headerTok != "" && queryTok != "" && headerTok != queryTok {
				return c.JSON(http.StatusBadRequest, map[string]string{
					"message": "Authorization header token and query token differ",
				})
			}

			effective := headerTok
			if effective == "" {
				effective = queryTok
			}
			if effective == "" || effective != cfg.AdminToken {
				return c.JSON(http.StatusUnauthorized, map[string]string{"message": "unauthorized"})
			}
			return next(c)
		}
	}
}
