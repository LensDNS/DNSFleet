package httpapi

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/lensdns/dnsfleet/internal/adguard"
)

// normalizeUpstreamText splits by line, trims, drops empties, sorts for stable compare.
func normalizeUpstreamText(text string) []string {
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		s := strings.TrimSpace(line)
		if s != "" {
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

func normalizeUpstreamSlice(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

func parseRewriteListJSON(b []byte) ([]adguard.RewriteEntry, error) {
	var list []adguard.RewriteEntry
	if len(strings.TrimSpace(string(b))) == 0 {
		return []adguard.RewriteEntry{}, nil
	}
	if err := json.Unmarshal(b, &list); err != nil {
		return nil, err
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Domain != list[j].Domain {
			return list[i].Domain < list[j].Domain
		}
		return list[i].Answer < list[j].Answer
	})
	return list, nil
}

func rewriteEntryEqual(a, b adguard.RewriteEntry) bool {
	if a.Domain != b.Domain || a.Answer != b.Answer {
		return false
	}
	return enabledEffective(a) == enabledEffective(b)
}

func enabledEffective(e adguard.RewriteEntry) bool {
	if e.Enabled == nil {
		return true
	}
	return *e.Enabled
}

func rewritesDeepEqualJSON(expectedBytes, actualBytes []byte) (bool, error) {
	exp, err := parseRewriteListJSON(expectedBytes)
	if err != nil {
		return false, err
	}
	act, err := parseRewriteListJSON(actualBytes)
	if err != nil {
		return false, err
	}
	if len(exp) != len(act) {
		return false, nil
	}
	for i := range exp {
		if !rewriteEntryEqual(exp[i], act[i]) {
			return false, nil
		}
	}
	return true, nil
}

// RewritesEqualFromLists compares expected JSON array bytes with the current AdGH rewrite list.
func RewritesEqualFromLists(expectedContent []byte, actual []adguard.RewriteEntry) (bool, error) {
	actJSON, err := json.Marshal(actual)
	if err != nil {
		return false, err
	}
	return rewritesDeepEqualJSON(expectedContent, actJSON)
}

func upstreamTextMatchesDNSConfig(text string, cfg *adguard.DNSConfig) bool {
	if cfg == nil {
		return len(normalizeUpstreamText(text)) == 0
	}
	a := normalizeUpstreamText(text)
	b := normalizeUpstreamSlice(cfg.UpstreamDNS)
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
