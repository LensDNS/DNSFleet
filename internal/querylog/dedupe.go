package querylog

// boundedDedupe is a FIFO-evicted set of string keys (§4.2.4 / §4.C best-effort dedupe).
type boundedDedupe struct {
	max   int
	order []string
	seen  map[string]struct{}
}

func newBoundedDedupe(max int) *boundedDedupe {
	if max < 1 {
		max = 1
	}
	return &boundedDedupe{
		max:  max,
		seen: make(map[string]struct{}),
	}
}

// firstTime returns true if key was not present (and records it).
func (d *boundedDedupe) firstTime(key string) bool {
	if d == nil {
		return false
	}
	if key == "" {
		return false
	}
	if _, ok := d.seen[key]; ok {
		return false
	}
	d.seen[key] = struct{}{}
	d.order = append(d.order, key)
	for len(d.order) > d.max {
		old := d.order[0]
		d.order = d.order[1:]
		delete(d.seen, old)
	}
	return true
}
