package main

import (
	"flag"
	"fmt"
	"io"
	"path/filepath"
)

func registerLaunchFlags(fs *flag.FlagSet) (admin, listen *string) {
	admin = fs.String("admin-token", "", "overrides DNSFLEET_ADMIN_TOKEN (empty = use env only)")
	listen = fs.String("listen", "", "overrides DNSFLEET_HTTP_ADDR (empty = use env / default :8080)")
	return admin, listen
}

// parseLaunchFlags parses argv[1:] for -admin-token and -listen using a private FlagSet.
// On -h / -help it returns flag.ErrHelp (caller prints usage and exits with 2).
func parseLaunchFlags(argv []string) (adminToken, listen string, err error) {
	if len(argv) == 0 {
		argv = []string{"dnsfleet"}
	}
	exe := filepath.Base(argv[0])
	fs := flag.NewFlagSet(exe, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	admin, listenPtr := registerLaunchFlags(fs)
	if err := fs.Parse(argv[1:]); err != nil {
		return "", "", err
	}
	return *admin, *listenPtr, nil
}

// writeUsage prints the same help text as historic global flag.Usage for this binary.
func writeUsage(w io.Writer, exe string) {
	fs := flag.NewFlagSet(exe, flag.ContinueOnError)
	fs.SetOutput(w)
	registerLaunchFlags(fs)
	fmt.Fprintf(w, "%s — self-hosted control plane for AdGuard Home fleets.\n\n", exe)
	fmt.Fprintf(w, "Optional flags (non-empty values override configuration fields after values are read from the environment):\n")
	fmt.Fprintf(w, "  -admin-token   Admin shared secret; overrides DNSFLEET_ADMIN_TOKEN.\n")
	fmt.Fprintf(w, "  -listen        HTTP listen address; overrides DNSFLEET_HTTP_ADDR (env default :8080).\n")
	fmt.Fprintf(w, "\nOther settings use environment variables only; see README \"Configuration\".\n")
	fmt.Fprintf(w, "On Unix, command-line arguments may be visible in ps(1); prefer env or a secret manager on shared systems.\n\n")
	fmt.Fprintf(w, "Usage of %s:\n", exe)
	fs.PrintDefaults()
}
