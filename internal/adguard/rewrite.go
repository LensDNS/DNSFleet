package adguard

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// ListRewrites calls GET /control/rewrite/list.
func (c *Client) ListRewrites(ctx context.Context) ([]RewriteEntry, error) {
	var list []RewriteEntry
	if err := c.doJSON(ctx, http.MethodGet, nil, "", &list, "rewrite", "list"); err != nil {
		return nil, err
	}
	if list == nil {
		list = []RewriteEntry{}
	}
	return list, nil
}

// ApplyRewritesFromJSON reconciles rewrite rules with desiredJSON (JSON array of RewriteEntry).
// Matching key is (domain, answer), case-sensitive. Same domain with different answer is delete+add.
// HTTP order is fixed: POST delete (only in current) → PUT update (same key, field change) → POST add (only in desired).
func (c *Client) ApplyRewritesFromJSON(ctx context.Context, desiredJSON []byte) error {
	var desiredList []RewriteEntry
	if err := json.Unmarshal(desiredJSON, &desiredList); err != nil {
		return fmt.Errorf("adguard: unmarshal desired rewrites: %w", err)
	}
	desired := make(map[string]RewriteEntry, len(desiredList))
	for _, e := range desiredList {
		k := rewriteKey(e.Domain, e.Answer)
		desired[k] = e // last duplicate wins
	}

	current, err := c.ListRewrites(ctx)
	if err != nil {
		return err
	}
	curMap := make(map[string]RewriteEntry, len(current))
	for _, e := range current {
		curMap[rewriteKey(e.Domain, e.Answer)] = e
	}

	var toDelete []RewriteEntry
	for k, e := range curMap {
		if _, ok := desired[k]; !ok {
			toDelete = append(toDelete, e)
		}
	}

	var toUpdate []rewriteUpdatePair
	for k, want := range desired {
		cur, ok := curMap[k]
		if !ok {
			continue
		}
		if rewriteNeedsUpdate(&cur, &want) {
			toUpdate = append(toUpdate, rewriteUpdatePair{current: cur, want: want})
		}
	}

	var toAdd []RewriteEntry
	for k, want := range desired {
		if _, ok := curMap[k]; !ok {
			toAdd = append(toAdd, want)
		}
	}

	for _, e := range toDelete {
		if err := c.postJSON(ctx, &e, "rewrite", "delete"); err != nil {
			return err
		}
	}
	for _, p := range toUpdate {
		upd := RewriteUpdate{
			Target: cloneEntry(&p.current),
			Update: mergeRewriteUpdate(&p.current, &p.want),
		}
		if err := c.putJSON(ctx, &upd, "rewrite", "update"); err != nil {
			return err
		}
	}
	for _, e := range toAdd {
		addBody := e
		if err := c.postJSON(ctx, &addBody, "rewrite", "add"); err != nil {
			return err
		}
	}
	return nil
}

type rewriteUpdatePair struct {
	current RewriteEntry
	want    RewriteEntry
}

func rewriteKey(domain, answer string) string {
	return domain + "\x00" + answer
}

func rewriteNeedsUpdate(cur, want *RewriteEntry) bool {
	if cur == nil || want == nil {
		return false
	}
	// Domain and answer define the key; already equal here.
	switch {
	case want.Enabled == nil:
		return false
	case cur.Enabled == nil:
		return true
	default:
		return *cur.Enabled != *want.Enabled
	}
}

func mergeRewriteUpdate(cur, want *RewriteEntry) *RewriteEntry {
	out := RewriteEntry{
		Domain: cur.Domain,
		Answer: cur.Answer,
	}
	if want.Enabled != nil {
		v := *want.Enabled
		out.Enabled = &v
	} else if cur.Enabled != nil {
		v := *cur.Enabled
		out.Enabled = &v
	}
	return &out
}

func cloneEntry(e *RewriteEntry) *RewriteEntry {
	if e == nil {
		return nil
	}
	out := *e
	if e.Enabled != nil {
		v := *e.Enabled
		out.Enabled = &v
	}
	return &out
}
