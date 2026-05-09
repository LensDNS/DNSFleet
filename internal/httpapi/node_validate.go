package httpapi

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/lensdns/dnsfleet/internal/models"
)

type nodeWriteRequest struct {
	Name       string `json:"name"`
	BaseURL    string `json:"base_url"`
	Username   string `json:"username"`
	Credential string `json:"credential"`
	AuthKind   string `json:"auth_kind"`
}

func validateNodeInput(in *nodeWriteRequest) error {
	if in == nil {
		return fmt.Errorf("body required")
	}
	if strings.TrimSpace(in.Name) == "" {
		return fmt.Errorf("name is required")
	}
	base := models.NormalizeBaseURL(in.BaseURL)
	if base == "" {
		return fmt.Errorf("base_url is required")
	}
	u, err := url.Parse(base)
	if err != nil {
		return fmt.Errorf("base_url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("base_url must use http or https scheme")
	}
	if u.Host == "" {
		return fmt.Errorf("base_url must include host")
	}
	switch in.AuthKind {
	case models.AuthKindBasic:
		if strings.TrimSpace(in.Username) == "" {
			return fmt.Errorf("username is required for basic auth")
		}
	case models.AuthKindBearer:
	default:
		return fmt.Errorf("auth_kind must be %q or %q", models.AuthKindBasic, models.AuthKindBearer)
	}
	if strings.TrimSpace(in.Credential) == "" {
		return fmt.Errorf("credential is required")
	}
	return nil
}

func applyNodeWriteRequest(n *models.Node, in *nodeWriteRequest) {
	n.Name = strings.TrimSpace(in.Name)
	n.BaseURL = models.NormalizeBaseURL(in.BaseURL)
	n.Username = strings.TrimSpace(in.Username)
	n.Credential = strings.TrimSpace(in.Credential)
	n.AuthKind = in.AuthKind
}
