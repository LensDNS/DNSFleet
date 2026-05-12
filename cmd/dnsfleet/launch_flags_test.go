package main

import (
	"errors"
	"flag"
	"strings"
	"testing"
)

func TestParseLaunchFlags_adminToken(t *testing.T) {
	admin, listen, err := parseLaunchFlags([]string{"dnsfleet", "-admin-token", "x"})
	if err != nil {
		t.Fatal(err)
	}
	if admin != "x" || listen != "" {
		t.Fatalf("got admin=%q listen=%q", admin, listen)
	}
}

func TestParseLaunchFlags_listen(t *testing.T) {
	admin, listen, err := parseLaunchFlags([]string{"dnsfleet", "-listen", ":9090"})
	if err != nil {
		t.Fatal(err)
	}
	if admin != "" || listen != ":9090" {
		t.Fatalf("got admin=%q listen=%q", admin, listen)
	}
}

func TestParseLaunchFlags_both(t *testing.T) {
	admin, listen, err := parseLaunchFlags([]string{"dnsfleet", "-listen", ":1", "-admin-token", "t"})
	if err != nil {
		t.Fatal(err)
	}
	if admin != "t" || listen != ":1" {
		t.Fatalf("got admin=%q listen=%q", admin, listen)
	}
}

func TestParseLaunchFlags_unknownFlag(t *testing.T) {
	_, _, err := parseLaunchFlags([]string{"dnsfleet", "-nope"})
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, flag.ErrHelp) {
		t.Fatal("unexpected ErrHelp")
	}
}

func TestParseLaunchFlags_help(t *testing.T) {
	for _, argv := range [][]string{
		{"dnsfleet", "-h"},
		{"dnsfleet", "-help"},
	} {
		t.Run(strings.Join(argv[1:], "_"), func(t *testing.T) {
			_, _, err := parseLaunchFlags(argv)
			if !errors.Is(err, flag.ErrHelp) {
				t.Fatalf("want ErrHelp, got %v", err)
			}
		})
	}
}

func TestWriteUsage_smoke(t *testing.T) {
	var b strings.Builder
	writeUsage(&b, "dnsfleet")
	out := b.String()
	if !strings.Contains(out, "-admin-token") || !strings.Contains(out, "-listen") {
		t.Fatalf("usage missing flags:\n%s", out)
	}
}
