package adguard

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetStats_success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/control/stats" || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"num_dns_queries":           100,
			"num_blocked_filtering":     7,
			"avg_processing_time":       0.0123,
			"num_replaced_safebrowsing": 0,
		})
	}))
	t.Cleanup(srv.Close)

	cl, err := NewClient(srv.URL, "u", "p", "basic")
	if err != nil {
		t.Fatal(err)
	}
	st, err := cl.GetStats(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.NumDNSQueries != 100 || st.NumBlockedFiltering != 7 {
		t.Fatalf("counts: %+v", st)
	}
	if st.AvgProcessingTime < 0.012 || st.AvgProcessingTime > 0.013 {
		t.Fatalf("avg_processing_time: %v", st.AvgProcessingTime)
	}
}
