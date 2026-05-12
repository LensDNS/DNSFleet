package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
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
	flag.Usage = func() {
		out := flag.CommandLine.Output()
		fmt.Fprintf(out, "%s — self-hosted control plane for AdGuard Home fleets.\n\n", exe)
		fmt.Fprintf(out, "Optional flags (non-empty values override configuration fields after values are read from the environment):\n")
		fmt.Fprintf(out, "  -admin-token   Admin shared secret; overrides DNSFLEET_ADMIN_TOKEN.\n")
		fmt.Fprintf(out, "  -listen        HTTP listen address; overrides DNSFLEET_HTTP_ADDR (env default :8080).\n")
		fmt.Fprintf(out, "\nOther settings use environment variables only; see README \"Configuration\".\n")
		fmt.Fprintf(out, "On Unix, command-line arguments may be visible in ps(1); prefer env or a secret manager on shared systems.\n\n")
		fmt.Fprintf(out, "Usage of %s:\n", exe)
		flag.PrintDefaults()
	}

	adminToken := flag.String("admin-token", "", "overrides DNSFLEET_ADMIN_TOKEN (empty = use env only)")
	listen := flag.String("listen", "", "overrides DNSFLEET_HTTP_ADDR (empty = use env / default :8080)")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	config.ApplyLaunchOverrides(&cfg, *adminToken, *listen)
	if !cfg.AdminInsecureDisable && cfg.AdminToken == "" {
		log.Fatalf("admin token required: set DNSFLEET_ADMIN_TOKEN or pass -admin-token, or set DNSFLEET_ADMIN_INSECURE_DISABLE=1")
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
