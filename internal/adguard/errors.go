package adguard

import (
	"errors"
	"fmt"
)

// ErrBearerRequiresProxy is returned when AuthKind is bearer but WithAllowBearerForProxy was not set.
// Stock AdGuard Home does not document Bearer for /control; use Basic or a proxy that accepts Bearer.
var ErrBearerRequiresProxy = errors.New("adguard: bearer auth requires WithAllowBearerForProxy (reverse proxy / ops convention); use basic or terminate Bearer in front of AdGuard Home")

// ErrHTTPUnauthorized is returned for HTTP 401 responses from AdGuard Home.
var ErrHTTPUnauthorized = errors.New("adguard: HTTP 401 unauthorized")

// ErrHTTPForbidden is returned for HTTP 403 responses from AdGuard Home.
var ErrHTTPForbidden = errors.New("adguard: HTTP 403 forbidden")

// ErrJSONDecode wraps JSON decode failures on successful (2xx) responses.
type ErrJSONDecode struct {
	Err error
}

func (e *ErrJSONDecode) Error() string {
	return fmt.Sprintf("adguard: decode JSON: %v", e.Err)
}

func (e *ErrJSONDecode) Unwrap() error {
	return e.Err
}

// HTTPStatusError is returned for non-2xx responses other than 401/403 when no more specific sentinel applies.
type HTTPStatusError struct {
	StatusCode int
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("adguard: HTTP status %d", e.StatusCode)
}
