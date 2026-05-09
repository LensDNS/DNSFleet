package httpapi

import (
	"github.com/lensdns/dnsfleet/internal/adguard"
	"github.com/lensdns/dnsfleet/internal/models"
)

func adguardClientFor(n *models.Node) (*adguard.Client, error) {
	return adguard.NewClientFromNode(n)
}
