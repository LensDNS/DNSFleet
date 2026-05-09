package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/config"
	fleetdb "github.com/lensdns/dnsfleet/internal/db"
	"github.com/lensdns/dnsfleet/internal/httpapi"
	"github.com/lensdns/dnsfleet/internal/querylog"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if !cfg.AdminInsecureDisable && cfg.AdminToken == "" {
		log.Fatalf("DNSFLEET_ADMIN_TOKEN is required unless DNSFLEET_ADMIN_INSECURE_DISABLE=1")
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

	// Root ctx drives drift; Echo does not cancel it — signal handler must call cancel before e.Shutdown.
	ctxRoot, cancel := context.WithCancel(context.Background())
	defer cancel()

	sem := make(chan struct{}, cfg.SyncMaxConcurrent)
	hub := querylog.NewHub(ctxRoot, gormDB, cfg)
	deps := httpapi.Deps{Config: cfg, DB: gormDB, AdGHSem: sem, Hub: hub}

	e := echo.New()
	e.HideBanner = true
	e.GET("/healthz", func(c echo.Context) error {
		return c.String(http.StatusOK, "ok")
	})
	httpapi.Mount(e, deps)

	go httpapi.StartDriftLoop(ctxRoot, deps)

	go func() {
		if err := e.Start(cfg.HTTPAddr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("http server: %v", err)
			cancel()
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig

	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
}
