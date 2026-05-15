package querylog

import (
	"context"
	"testing"

	"github.com/lensdns/dnsfleet/internal/config"
	"github.com/lensdns/dnsfleet/internal/models"
)

func TestRecordPollFailure_nil_node(t *testing.T) {
	h := &Hub{ctx: context.Background()}
	h.recordPollFailure(nil) // must not panic
}

func TestRecordPollFailure_marks_offline_after_three(t *testing.T) {
	db := openTestDB(t)
	n := models.Node{
		Name:       "poll-fail",
		BaseURL:    "http://example.invalid",
		Username:   "u",
		Credential: "p",
		AuthKind:   models.AuthKindBasic,
		Online:     true,
		Version:    "v1",
	}
	if err := db.Create(&n).Error; err != nil {
		t.Fatal(err)
	}

	h := &Hub{
		ctx: context.Background(),
		db:  db,
		cfg: integrationHubCfg(),
	}

	h.recordPollFailure(&n)
	h.recordPollFailure(&n)
	var mid models.Node
	if err := db.First(&mid, n.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !mid.Online {
		t.Fatal("want still online after 2 failures")
	}

	h.recordPollFailure(&n)
	var after models.Node
	if err := db.First(&after, n.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Online {
		t.Fatal("want offline after 3 failures")
	}
}

func TestClearPollFailure_resets_streak(t *testing.T) {
	db := openTestDB(t)
	n := models.Node{
		Name:       "poll-clear",
		BaseURL:    "http://example.invalid",
		Username:   "u",
		Credential: "p",
		AuthKind:   models.AuthKindBasic,
		Online:     true,
	}
	if err := db.Create(&n).Error; err != nil {
		t.Fatal(err)
	}

	h := &Hub{
		ctx: context.Background(),
		db:  db,
		cfg: config.Config{WsMaxFrameBytes: config.DefaultWSMaxFrameBytes},
	}

	h.recordPollFailure(&n)
	h.recordPollFailure(&n)
	h.clearPollFailure(n.ID)
	h.recordPollFailure(&n)
	h.recordPollFailure(&n)

	var mid models.Node
	if err := db.First(&mid, n.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !mid.Online {
		t.Fatal("want still online after 2 failures post-clear (need 3 consecutive)")
	}

	h.recordPollFailure(&n)
	var after models.Node
	if err := db.First(&after, n.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Online {
		t.Fatal("want offline after 3rd failure in new streak")
	}
}
