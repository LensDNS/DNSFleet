package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/lensdns/dnsfleet/internal/config"
	fleetdb "github.com/lensdns/dnsfleet/internal/db"
	"github.com/lensdns/dnsfleet/internal/httpapi"
	"github.com/lensdns/dnsfleet/internal/querylog"
	"github.com/lensdns/dnsfleet/internal/webui"
)

func main() {
	exe := filepath.Base(os.Args[0])
	adminToken, listenAddr, err := parseLaunchFlags(os.Args)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeUsage(os.Stderr, exe)
			os.Exit(2)
		}
		log.Fatalf("flags: %v", err)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	config.ApplyLaunchOverrides(&cfg, adminToken, listenAddr)
	if err := config.ValidateStartupAdmin(&cfg); err != nil {
		log.Fatalf("%v", err)
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
	webui.Mount(e)

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
