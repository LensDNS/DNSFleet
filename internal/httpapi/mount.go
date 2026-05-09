package httpapi

import (
	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/middleware"
)

// Mount registers GET /api/v1/ws/logs (WebSocket, AdminWS) and /api/v1 REST routes (Admin). Caller registers /healthz separately.
func Mount(e *echo.Echo, deps Deps) {
	r := &Routes{Deps: deps}

	ws := e.Group("/api/v1/ws")
	ws.Use(middleware.AdminWS(deps.Config))
	ws.GET("/logs", r.wsLogs)

	g := e.Group("/api/v1")
	g.Use(middleware.Admin(deps.Config))

	g.GET("/nodes", r.listNodes)
	g.POST("/nodes", r.postNode)
	g.GET("/nodes/:id", r.getNode)
	g.PATCH("/nodes/:id", r.patchNode)
	g.DELETE("/nodes/:id", r.deleteNode)

	g.GET("/config/global", r.getGlobal)
	g.PUT("/config/global", r.putGlobal)

	g.POST("/sync", r.postSync)
}
