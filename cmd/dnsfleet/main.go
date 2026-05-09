package main

import (
	"log"

	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/config"
	fleetdb "github.com/lensdns/dnsfleet/internal/db"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	gormDB, err := fleetdb.OpenAndMigrate(cfg.DBPath)
	if err != nil {
		log.Fatalf("database: %v", err)
	}

	sqlDB, err := gormDB.DB()
	if err != nil {
		log.Fatalf("database sql: %v", err)
	}
	defer func() {
		if cerr := sqlDB.Close(); cerr != nil {
			log.Printf("database close: %v", cerr)
		}
	}()

	e := echo.New()
	e.HideBanner = true
	e.GET("/healthz", func(c echo.Context) error {
		return c.String(200, "ok")
	})

	log.Printf("listening on %s (database %s)", cfg.HTTPAddr, cfg.DBPath)
	if err := e.Start(cfg.HTTPAddr); err != nil {
		log.Fatalf("http: %v", err)
	}
}
