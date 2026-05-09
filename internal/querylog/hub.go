package querylog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"gorm.io/gorm"

	"github.com/lensdns/dnsfleet/internal/adguard"
	"github.com/lensdns/dnsfleet/internal/config"
	"github.com/lensdns/dnsfleet/internal/models"
)

const (
	// outboundQueueCap: per-subscriber outbound buffer (§4.G bounded queue).
	outboundQueueCap = 256
	// dedupeMaxPerNode: §4.2.4 / §4.C best-effort dedupe fingerprint cap per node (FIFO evict oldest).
	dedupeMaxPerNode = 4096
	// configEveryNPolls: GET /control/querylog/config cadence per node (§4.2.6).
	configEveryNPolls = 10
	// configFetchErrBackoff: after GET querylog/config fails, skip refetch until this elapses (reduces hammering a sick upstream).
	configFetchErrBackoff = 10 * time.Second
	// maxQueryLogPagesPerTick: §4.C cursor walk — advance older_than=previous Oldest until a partial page or empty cursor; cap HTTP calls per node per tick.
	maxQueryLogPagesPerTick = 16
)

type subscriber struct {
	conn *websocket.Conn
	out  chan []byte
	stop chan struct{}
	once sync.Once
}

func (s *subscriber) closeStop() {
	s.once.Do(func() { close(s.stop) })
}

// wsLogMessage is Step 4 §4.E type=log.
type wsLogMessage struct {
	Type     string          `json:"type"`
	NodeID   uint            `json:"node_id"`
	NodeName string          `json:"node_name"`
	Entry    json.RawMessage `json:"entry"`
}

// Hub aggregates GET /control/querylog polling and fans out to WebSocket clients (Step 4 §4.2.1).
type Hub struct {
	ctx context.Context
	db  *gorm.DB
	cfg config.Config

	sem chan struct{}

	mu   sync.Mutex
	subs map[*websocket.Conn]*subscriber

	nodeMu                sync.Mutex
	nodeTail              map[uint]*boundedDedupe
	configPoll            map[uint]int // per-node tick counter for GET querylog/config cadence
	enabledCache          map[uint]bool
	configErrBackoffUntil map[uint]time.Time // skip GET querylog/config while time.Now() is before this
	disabledMsgSent       map[uint]bool

	coordinatorOnce sync.Once
}

// effectiveWsMaxFrameBytes returns WsMaxFrameBytes with a safe floor (config.Load uses >=1; callers may bypass).
func (h *Hub) effectiveWsMaxFrameBytes() int {
	n := h.cfg.WsMaxFrameBytes
	if n < 1 {
		return config.DefaultWSMaxFrameBytes
	}
	return n
}

// effectiveQueryLogPageLimit returns QueryLogPageLimit with a safe floor (config.Load uses >=1; callers may bypass).
func (h *Hub) effectiveQueryLogPageLimit() int {
	n := h.cfg.QueryLogPageLimit
	if n < 1 {
		return config.DefaultQueryLogPageLimit
	}
	return n
}

// NewHub starts the coordinator loop. Caller must use the same ctx as drift (§4.2.8).
func NewHub(ctx context.Context, db *gorm.DB, cfg config.Config) *Hub {
	// config.Load enforces QueryLogMaxConcurrent >= 1; clamp anyway so sem is never unbuffered (0 would deadlock pollTick).
	semCap := cfg.QueryLogMaxConcurrent
	if semCap < 1 {
		semCap = 1
	}
	h := &Hub{
		ctx:                   ctx,
		db:                    db,
		cfg:                   cfg,
		sem:                   make(chan struct{}, semCap),
		subs:                  make(map[*websocket.Conn]*subscriber),
		nodeTail:              make(map[uint]*boundedDedupe),
		configPoll:            make(map[uint]int),
		enabledCache:          make(map[uint]bool),
		configErrBackoffUntil: make(map[uint]time.Time),
		disabledMsgSent:       make(map[uint]bool),
	}
	h.coordinatorOnce.Do(func() { go h.runCoordinator() })
	return h
}

func (h *Hub) clearTailState() {
	h.nodeMu.Lock()
	h.nodeTail = make(map[uint]*boundedDedupe)
	h.configPoll = make(map[uint]int)
	h.enabledCache = make(map[uint]bool)
	h.configErrBackoffUntil = make(map[uint]time.Time)
	h.disabledMsgSent = make(map[uint]bool)
	h.nodeMu.Unlock()
}

// Register adds a WebSocket after Upgrade; sends system+connected first on the wire (§4.2.1).
// Returns false if conn is nil or the handshake write failed (caller should close conn; no subscriber state is kept).
func (h *Hub) Register(conn *websocket.Conn) bool {
	if conn == nil {
		return false
	}
	connected := systemMsg{
		Type:    "system",
		Event:   "connected",
		Message: "query log stream ready",
	}
	if err := writeWebSocketJSONObject(conn, h.effectiveWsMaxFrameBytes(), connected); err != nil {
		return false
	}

	sub := &subscriber{
		conn: conn,
		out:  make(chan []byte, outboundQueueCap),
		stop: make(chan struct{}),
	}

	h.mu.Lock()
	first := len(h.subs) == 0
	if first {
		h.clearTailState()
	}
	h.subs[conn] = sub
	h.mu.Unlock()

	go h.writePump(sub)
	return true
}

// Unregister is idempotent (defer + Ping failure + shutdown; §4.2.1).
func (h *Hub) Unregister(conn *websocket.Conn) {
	if conn == nil {
		return
	}
	h.mu.Lock()
	sub, ok := h.subs[conn]
	if !ok {
		h.mu.Unlock()
		return
	}
	delete(h.subs, conn)
	remaining := len(h.subs)
	h.mu.Unlock()

	sub.closeStop()

	if remaining == 0 {
		h.clearTailState()
	}
}

func (h *Hub) writePump(sub *subscriber) {
	if sub == nil || sub.conn == nil {
		return
	}
	for {
		select {
		case <-h.ctx.Done():
			return
		case <-sub.stop:
			return
		case b, ok := <-sub.out:
			if !ok {
				return
			}
			conn := sub.conn
			if err := writeWebSocketJSONObject(conn, h.effectiveWsMaxFrameBytes(), json.RawMessage(b)); err != nil {
				// §4.2.1: unregister on write failure; close socket so httpapi read loop can exit.
				h.Unregister(conn)
				_ = conn.Close()
				return
			}
		}
	}
}

func (h *Hub) tryEnqueue(sub *subscriber, msg []byte) error {
	if sub == nil {
		return fmt.Errorf("tryEnqueue: nil subscriber")
	}
	max := h.effectiveWsMaxFrameBytes()
	if len(msg) > max {
		fb, ferr := json.Marshal(systemMsg{
			Type:    "system",
			Event:   "frame_too_large",
			Message: "message exceeds DNSFLEET_WS_MAX_FRAME_BYTES",
		})
		if ferr != nil {
			return fmt.Errorf("tryEnqueue: marshal frame_too_large: %w", ferr)
		}
		if len(fb) > max {
			return fmt.Errorf("tryEnqueue: frame_too_large fallback exceeds WsMaxFrameBytes")
		}
		msg = fb
	}
	select {
	case sub.out <- msg:
		return nil
	default:
		// §4.G: drop oldest until we can queue backpressure_drop (optional) and msg — avoid enqueueing
		// only the notice and silently dropping the payload (single-slot pop + bp filled buffer).
		bp, berr := json.Marshal(systemMsg{
			Type:    "system",
			Event:   "backpressure_drop",
			Message: "subscriber queue full; dropped oldest message",
		})
		wantBP := berr == nil && len(bp) <= max
		toSend := [][]byte{msg}
		if wantBP {
			toSend = [][]byte{bp, msg}
		}
		for _, frame := range toSend {
		deliverFrame:
			for {
				select {
				case sub.out <- frame:
					break deliverFrame
				default:
					// Drop oldest to make room. If the consumer drained the queue between the failed
					// send and here, the receive default is a no-op — retry send (do not return nil).
					select {
					case <-sub.out:
					default:
					}
				}
			}
		}
		return nil
	}
}

func (h *Hub) broadcastJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.Lock()
	subs := make([]*subscriber, 0, len(h.subs))
	for _, s := range h.subs {
		subs = append(subs, s)
	}
	h.mu.Unlock()
	for _, s := range subs {
		_ = h.tryEnqueue(s, b)
	}
}

func (h *Hub) runCoordinator() {
	// config.Load requires positive interval; clamp so NewTicker never panics on d<=0.
	interval := h.cfg.QueryLogPollInterval
	if interval <= 0 {
		interval = config.DefaultQueryLogPollInterval
	}
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-h.ctx.Done():
			h.shutdownSubs()
			return
		case <-tick.C:
			h.mu.Lock()
			n := len(h.subs)
			h.mu.Unlock()
			if n == 0 {
				continue
			}
			h.pollTick()
		}
	}
}

func (h *Hub) shutdownSubs() {
	h.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(h.subs))
	for c := range h.subs {
		conns = append(conns, c)
	}
	h.mu.Unlock()
	for _, c := range conns {
		h.Unregister(c)
		_ = c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, ""))
		_ = c.Close()
	}
}

func (h *Hub) pollTick() {
	if h.db == nil {
		return
	}
	var nodes []models.Node
	if err := h.db.WithContext(h.ctx).Where("online = ?", true).Find(&nodes).Error; err != nil {
		return
	}
	var wg sync.WaitGroup
	for i := range nodes {
		node := nodes[i]
		wg.Add(1)
		go func(n models.Node) {
			defer wg.Done()
			select {
			case h.sem <- struct{}{}:
				defer func() { <-h.sem }()
			case <-h.ctx.Done():
				return
			}
			h.pollNode(&n)
		}(node)
	}
	wg.Wait()
}

func (h *Hub) pollNode(node *models.Node) {
	if node == nil {
		return
	}
	cl, err := adguard.NewClientFromNode(node)
	if err != nil {
		h.broadcastJSON(systemMsg{
			Type:     "system",
			Event:    "upstream_error",
			Message:  "failed to build upstream client",
			NodeID:   node.ID,
			NodeName: node.Name,
		})
		return
	}

	h.nodeMu.Lock()
	h.configPoll[node.ID]++
	pc := h.configPoll[node.ID]
	_, hasCache := h.enabledCache[node.ID]
	backoffUntil, hasBackoffKey := h.configErrBackoffUntil[node.ID]
	skipConfigDueBackoff := hasBackoffKey && time.Now().Before(backoffUntil)
	h.nodeMu.Unlock()

	// First poll after cache clear, or every N ticks (§4.2.6); respect post-error backoff.
	wantConfig := !hasCache || (pc-1)%configEveryNPolls == 0
	doCfg := wantConfig && !skipConfigDueBackoff

	if doCfg {
		cfgResp, err := cl.GetQueryLogConfig(h.ctx)
		if err != nil {
			h.emitUpstreamError(node, err)
			h.nodeMu.Lock()
			h.configErrBackoffUntil[node.ID] = time.Now().Add(configFetchErrBackoff)
			if _, ok := h.enabledCache[node.ID]; !ok {
				h.enabledCache[node.ID] = true
			}
			h.nodeMu.Unlock()
			// Continue to live tail; optimistic enabled when upstream state is unknown.
		} else {
			h.nodeMu.Lock()
			delete(h.configErrBackoffUntil, node.ID)
			h.enabledCache[node.ID] = cfgResp.Enabled
			if !cfgResp.Enabled {
				shouldEmit := !h.disabledMsgSent[node.ID]
				if shouldEmit {
					h.disabledMsgSent[node.ID] = true
				}
				h.nodeMu.Unlock()
				if shouldEmit {
					h.broadcastJSON(systemMsg{
						Type:     "system",
						Event:    "querylog_disabled",
						Message:  "query log disabled on upstream AdGuard Home",
						NodeID:   node.ID,
						NodeName: node.Name,
					})
				}
				return
			}
			h.disabledMsgSent[node.ID] = false
			h.nodeMu.Unlock()
		}
	} else {
		h.nodeMu.Lock()
		en, ok := h.enabledCache[node.ID]
		h.nodeMu.Unlock()
		if ok && !en {
			return
		}
	}

	// Live tail (Step 4 §4.C): first GET omits older_than (latest window via GetQueryLog); then each
	// full page uses previous response’s Oldest as older_than until partial page, empty cursor, or
	// maxQueryLogPagesPerTick (bounded HTTP).
	h.nodeMu.Lock()
	d := h.nodeTail[node.ID]
	if d == nil {
		d = newBoundedDedupe(dedupeMaxPerNode)
		h.nodeTail[node.ID] = d
	}
	h.nodeMu.Unlock()

	limit := h.effectiveQueryLogPageLimit()
	olderThan := ""
	for range maxQueryLogPagesPerTick {
		ql, err := cl.GetQueryLog(h.ctx, olderThan, 0, limit, "all", "")
		if err != nil {
			h.emitUpstreamError(node, err)
			return
		}
		h.emitQueryLogData(node, d, ql.Data)
		if len(ql.Data) < limit || ql.Oldest == "" {
			return
		}
		olderThan = ql.Oldest
	}
}

func (h *Hub) emitQueryLogData(node *models.Node, d *boundedDedupe, data []json.RawMessage) {
	if node == nil || d == nil {
		return
	}
	for _, raw := range data {
		sum := sha256.Sum256(raw)
		key := hex.EncodeToString(sum[:])
		if !d.firstTime(key) {
			continue
		}
		h.broadcastJSON(wsLogMessage{
			Type:     "log",
			NodeID:   node.ID,
			NodeName: node.Name,
			Entry:    raw,
		})
	}
}

func (h *Hub) emitUpstreamError(node *models.Node, err error) {
	if node == nil {
		return
	}
	msg := "upstream request failed"
	if adguard.IsHTTPUnauthorized(err) {
		msg = "upstream returned 401"
	} else if adguard.IsHTTPForbidden(err) {
		msg = "upstream returned 403"
	} else if he := adguard.HTTPStatusCode(err); he > 0 {
		msg = fmt.Sprintf("upstream returned HTTP %d", he)
	}
	h.broadcastJSON(systemMsg{
		Type:     "system",
		Event:    "upstream_error",
		Message:  msg,
		NodeID:   node.ID,
		NodeName: node.Name,
	})
}
