package middleware

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/config"
)

// Admin enforces DNSFLEET_ADMIN_TOKEN on /api/v1 when AdminInsecureDisable is false.
// Bearer in Authorization takes precedence for comparison when both headers carry a token value.
func Admin(cfg config.Config) echo.MiddlewareFunc {
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
			tok := bearer
			if tok == "" {
				tok = xTok
			}
			if tok == "" || tok != cfg.AdminToken {
				return c.JSON(http.StatusUnauthorized, map[string]string{"message": "unauthorized"})
			}
			return next(c)
		}
	}
}
