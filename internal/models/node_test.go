package models

import (
	"encoding/json"
	"testing"
)

func TestNormalizeBaseURL(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"", ""},
		{"  https://agh.example  ", "https://agh.example"},
		{"https://agh.example/", "https://agh.example"},
		{"https://agh.example/// ", "https://agh.example"},
	}
	for _, tt := range tests {
		if got := NormalizeBaseURL(tt.in); got != tt.want {
			t.Errorf("NormalizeBaseURL(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

// RewriteEntry 形状与 api/ADGUARD_HOME_CONTROL_API.md §4 对齐（单测 smoke，非 Schema 校验）。
type rewriteEntry struct {
	Domain string `json:"domain"`
	Answer string `json:"answer"`
}

func TestGlobalConfigRewriteContentJSON(t *testing.T) {
	empty := `[]`
	var emptyArr []rewriteEntry
	if err := json.Unmarshal([]byte(empty), &emptyArr); err != nil || len(emptyArr) != 0 {
		t.Fatalf("empty rewrite: %v, len=%d", err, len(emptyArr))
	}

	sample := `[{"domain":"example.com","answer":"1.2.3.4"}]`
	var arr []rewriteEntry
	if err := json.Unmarshal([]byte(sample), &arr); err != nil {
		t.Fatal(err)
	}
	if len(arr) != 1 || arr[0].Domain != "example.com" || arr[0].Answer != "1.2.3.4" {
		t.Fatalf("got %+v", arr)
	}
}
