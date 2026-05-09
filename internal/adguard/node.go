package adguard

import (
	"fmt"

	"github.com/lensdns/dnsfleet/internal/models"
)

// NewClientFromNode builds a Client from a persisted Node (same construction rules as
// httpapi adguardClientFor: Bearer uses WithAllowBearerForProxy for proxy-terminated auth).
func NewClientFromNode(n *models.Node) (*Client, error) {
	if n == nil {
		return nil, fmt.Errorf("adguard: node is nil")
	}
	opts := []ClientOption{}
	if n.AuthKind == models.AuthKindBearer {
		opts = append(opts, WithAllowBearerForProxy())
	}
	return NewClient(n.BaseURL, n.Username, n.Credential, n.AuthKind, opts...)
}
