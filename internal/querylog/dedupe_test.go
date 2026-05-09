package querylog

import "testing"

func TestBoundedDedupe_firstTime_emptyKey(t *testing.T) {
	d := newBoundedDedupe(4)
	if d.firstTime("") {
		t.Fatal("empty key should not be treated as first-time")
	}
	if d.firstTime("a") != true || d.firstTime("a") != false {
		t.Fatal("non-empty key dedupe behavior")
	}
}

func TestBoundedDedupe_firstTime_nilReceiver(t *testing.T) {
	var d *boundedDedupe
	if d.firstTime("x") {
		t.Fatal("nil receiver should not claim first-time")
	}
}

func TestNewBoundedDedupe_nonPositiveMaxClamped(t *testing.T) {
	d := newBoundedDedupe(0)
	if d.max != 1 {
		t.Fatalf("max: got %d want 1", d.max)
	}
	d2 := newBoundedDedupe(-3)
	if d2.max != 1 {
		t.Fatalf("max: got %d want 1", d2.max)
	}
}
