package adguard

import "errors"

// ErrBearerRequiresProxy is returned when AuthKind is bearer but WithAllowBearerForProxy was not set.
// Stock AdGuard Home does not document Bearer for /control; use Basic or a proxy that accepts Bearer.
var ErrBearerRequiresProxy = errors.New("adguard: bearer auth requires WithAllowBearerForProxy (reverse proxy / ops convention); use basic or terminate Bearer in front of AdGuard Home")
