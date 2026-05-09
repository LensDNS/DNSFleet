package httpapi

import (
	"github.com/lensdns/dnsfleet/internal/adguard"
	"github.com/lensdns/dnsfleet/internal/models"
)

func adguardClientFor(n *models.Node) (*adguard.Client, error) {
	opts := []adguard.ClientOption{}
	if n.AuthKind == models.AuthKindBearer {
		opts = append(opts, adguard.WithAllowBearerForProxy())
	}
	return adguard.NewClient(n.BaseURL, n.Username, n.Credential, n.AuthKind, opts...)
}
