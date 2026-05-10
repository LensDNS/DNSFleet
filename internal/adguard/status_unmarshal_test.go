package adguard

import (
	"encoding/json"
	"testing"
)

func TestServerStatusUnmarshal_adguard0107StatusBody(t *testing.T) {
	// Minimal shape matching AdGuardHome v0.107 GET /control/status (start_time is float).
	j := `{"version":"v0.107.74","language":"","dns_port":53,"http_port":3000,"protection_disabled_duration":0,"start_time":1778409625924.615,"protection_enabled":true,"dhcp_available":false,"running":true}`
	var st ServerStatus
	if err := json.Unmarshal([]byte(j), &st); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if st.Version != "v0.107.74" {
		t.Fatalf("version got %q", st.Version)
	}
}
