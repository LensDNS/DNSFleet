package httpapi

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/lensdns/dnsfleet/internal/models"
	"gorm.io/gorm"
)

type syncRequest struct {
	NodeIDs json.RawMessage `json:"node_ids"`
}

type syncNodeResult struct {
	NodeID uint   `json:"node_id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

type syncResponse struct {
	Results   []syncNodeResult `json:"results"`
	Selection string           `json:"selection"`
}

func classifyNodeIDs(raw json.RawMessage) (selection string, ids []uint, err error) {
	if raw == nil {
		return "all_online", nil, nil
	}
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return "all_online", nil, nil
	}
	if s == "[]" {
		return "empty_list", nil, nil
	}
	var out []uint
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", nil, err
	}
	return "listed", out, nil
}

func isRetriableSync(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	return false
}

func withTimeoutRetry(ctx context.Context, fn func() error) error {
	delays := []time.Duration{0, 100 * time.Millisecond, 200 * time.Millisecond}
	var last error
	for i, d := range delays {
		if d > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(d):
			}
		}
		last = fn()
		if last == nil {
			return nil
		}
		if !isRetriableSync(last) || i == len(delays)-1 {
			break
		}
	}
	return last
}

func unknownNodeIDs(db *gorm.DB, ctx context.Context, want []uint) ([]uint, error) {
	if len(want) == 0 {
		return nil, nil
	}
	var got []uint
	if err := db.WithContext(ctx).Model(&models.Node{}).Where("id IN ?", want).Pluck("id", &got).Error; err != nil {
		return nil, err
	}
	present := make(map[uint]struct{}, len(got))
	for _, id := range got {
		present[id] = struct{}{}
	}
	var unknown []uint
	for _, id := range want {
		if _, ok := present[id]; !ok {
			unknown = append(unknown, id)
		}
	}
	return unknown, nil
}

func (r *Routes) postSync(c echo.Context) error {
	raw, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "read body")
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = []byte("{}")
	}
	var req syncRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "invalid JSON"})
	}
	sel, ids, err := classifyNodeIDs(req.NodeIDs)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"message": "node_ids must be an array of unsigned integers"})
	}
	if sel == "listed" {
		unk, err := unknownNodeIDs(r.Deps.DB, c.Request().Context(), ids)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "database error")
		}
		if len(unk) > 0 {
			return c.JSON(http.StatusBadRequest, map[string]any{
				"message":     "unknown node ids",
				"unknown_ids": unk,
			})
		}
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), r.Deps.Config.SyncTotalTimeout)
	defer cancel()

	upstream, rewJSON, err := loadGlobalUpstreamRewrite(ctx, r.Deps.DB)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database error")
	}

	var targets []models.Node
	switch sel {
	case "empty_list":
		// no nodes
	case "all_online":
		if err := r.Deps.DB.WithContext(ctx).Where("online = ?", true).Order("id").Find(&targets).Error; err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "database error")
		}
	case "listed":
		if err := r.Deps.DB.WithContext(ctx).Where("id IN ?", ids).Order("id").Find(&targets).Error; err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "database error")
		}
	}

	results := make([]syncNodeResult, 0, len(targets))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := range targets {
		n := targets[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := syncNodeResult{NodeID: n.ID}
			syncErr := func() error {
				if err := acquire(ctx, r.Deps.AdGHSem); err != nil {
					return err
				}
				defer release(r.Deps.AdGHSem)
				cl, err := adguardClientFor(&n)
				if err != nil {
					return err
				}
				if err := withTimeoutRetry(ctx, func() error {
					return cl.SetUpstreamDNSFromGlobalText(ctx, upstream)
				}); err != nil {
					return err
				}
				return withTimeoutRetry(ctx, func() error {
					return cl.ApplyRewritesFromJSON(ctx, rewJSON)
				})
			}()
			if syncErr != nil {
				res.OK = false
				res.Error = syncErr.Error()
			} else {
				res.OK = true
				now := time.Now().UTC()
				_ = r.Deps.DB.WithContext(ctx).Model(&models.Node{}).Where("id = ?", n.ID).Update("last_sync_at", &now).Error
			}
			mu.Lock()
			results = append(results, res)
			mu.Unlock()
		}()
	}
	wg.Wait()

	slices.SortFunc(results, func(a, b syncNodeResult) int {
		return cmp.Compare(a.NodeID, b.NodeID)
	})

	return c.JSON(http.StatusOK, syncResponse{Results: results, Selection: sel})
}
