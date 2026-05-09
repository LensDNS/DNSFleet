# internal/adguard

AdGuard Home **control plane** HTTP client (`/control/*`). Step **2.1** implements construction-time validation, **Basic** / **Bearer (proxy-only)** auth, timeouts, and internal request helpers. Step **2.2** adds status, DNS, and rewrite calls.

## Contract

Single source of truth: [`api/ADGUARD_HOME_CONTROL_API.md`](../../api/ADGUARD_HOME_CONTROL_API.md) (OpenAPI-aligned). Minimum compatible AdGH versions: follow that document and upstream `openapi/CHANGELOG.md` (do not duplicate version pins here).

## Step 2.1 scope (must match detailed plan §2.1)

- **No** browser Cookie session and **no** `POST /control/login`; only `Authorization: Basic` or `Authorization: Bearer` when explicitly allowed for proxy setups.
- **No** “no-credentials” nodes; callers must supply non-empty credential (see `docs/详细开发计划.md` §1.3, local only).
- **Official** OpenAPI paths only; **no** OEM / GL.iNet-specific headers or routes in this milestone.
- **`BaseURL` v0.1**: panel **origin** only (`scheme://host[:port]`, no `/control` suffix). The client joins `control/<segment>/...` via `net/url.JoinPath`.

## Paths used in Step 2 (listed for review; Step 2.2 implements callers)

| Area | Paths |
|------|--------|
| Status | `GET /control/status` |
| Upstream DNS | `GET /control/dns_info`, `POST /control/dns_config` |
| Rewrites | `GET /control/rewrite/list`, `POST /control/rewrite/add`, `POST /control/rewrite/delete`, `PUT /control/rewrite/update`, rewrite settings per API §4 |

Exact shapes and bodies: **API markdown** above.

## Bearer and `WithAllowBearerForProxy`

Official AdGH OpenAPI does not contract `Authorization: Bearer` for stock installs. By default, `AuthKind=bearer` **fails at `NewClient`** unless **`WithAllowBearerForProxy()`** is set (reverse proxy or ops convention that terminates Bearer). See API doc section **DNSFleet 与 Node.AuthKind**.
