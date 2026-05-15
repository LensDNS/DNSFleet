# internal/adguard

AdGuard Home **control plane** HTTP client (`/control/*`). Step **2.1**: construction, **Basic** / **Bearer (proxy-only)** auth, timeouts, `do` / URL join. Step **2.2**: `doJSON`, status, DNS read-modify-write, rewrite reconcile.

## Contract

Single source of truth: [`api/ADGUARD_HOME_CONTROL_API.md`](../../api/ADGUARD_HOME_CONTROL_API.md). Field-level detail: that document and upstream `openapi/openapi.yaml` (not vendored in this repo).

## Step 2.1 scope (detailed plan §2.1)

- **No** browser Cookie session and **no** `POST /control/login`; only `Authorization: Basic` or `Authorization: Bearer` when explicitly allowed for proxy setups.
- **No** “no-credentials” nodes; callers must supply non-empty credential (see local `docs/详细开发计划.md` §1.3).
- **Official** OpenAPI paths only; **no** OEM / GL.iNet-specific headers or routes in this milestone.
- **`BaseURL` v0.1**: panel **origin** only (`scheme://host[:port]`, no `/control` suffix). The client joins `control/<segment>/...` via `net/url.JoinPath`.

## Step 2.2 — exported methods (Q4 naming source of truth)

| Method | AdGH paths | Notes |
|--------|------------|--------|
| `(*Client) GetStatus(ctx)` | `GET /control/status` | Loose JSON decode; at least `version` is populated when present. |
| `(*Client) GetStats(ctx)` | `GET /control/stats` | Minimal `Stats` decode (`num_dns_queries`, `num_blocked_filtering`, `avg_processing_time` seconds). No `recent` query in v0.1.4. |
| `(*Client) GetDNSConfig(ctx)` | `GET /control/dns_info` | Decodes the **`DNSConfig`** object; extra top-level keys from `dns_info` **allOf** are ignored. |
| `(*Client) SetUpstreamDNSFromGlobalText(ctx, upstreamLines)` | `GET /control/dns_info`, `POST /control/dns_config` | Read–modify–write: replaces only `upstream_dns` from multi-line text (see §1.3 upstream `GlobalConfig`: non-empty trimmed lines). |
| `(*Client) ListRewrites(ctx)` | `GET /control/rewrite/list` | Returns `[]RewriteEntry` (empty slice if null). |
| `(*Client) ApplyRewritesFromJSON(ctx, desiredJSON)` | `GET /control/rewrite/list`, `POST …/delete`, `PUT …/update`, `POST …/add` | Desired body: JSON array of `RewriteEntry`. |

## DNS (Q1 = B): `dns_info` vs `dns_config`

- **`GET /dns_info`** response is OpenAPI **`allOf` [`DNSConfig`, extension object]** (e.g. extra keys such as `default_local_ptr_upstreams`). This client **decodes only** into the hand-written **`DNSConfig`** struct; extension keys are **not** stored and **must not** appear on **`POST /dns_config`** (POST body is **`DNSConfig` only**; do not add undeclared keys to “fix” extensions).
- **Read–modify–write** for upstream: `GetDNSConfig` → edit `UpstreamDNS` → `POST dns_config` with the full **`DNSConfig`** value (see `SetUpstreamDNSFromGlobalText`).
- **v0.1 assumption (verify on real instances):** posting **only** `DNSConfig` leaves **extension** fields from `dns_info` **unchanged** on the server. If a real AdGH build **clears** extensions and that is unacceptable, check OpenAPI for another write path or document a product limitation—**do not** send non-contract keys on `POST dns_config`.

## Rewrite diff (Q2 = A)

- Match key **`(domain, answer)`**, case-sensitive. Same domain with a **different** answer → **`delete`** old row + **`add`** new row (not `update`).
- **`PUT /control/rewrite/update`**: `RewriteUpdate.target` must be the **full `RewriteEntry` from `ListRewrites`** for that key (server-side locator). Do not substitute a hand-built stub unless it matches the list row exactly.
- **HTTP call order (fixed):** **`delete` → `update` → `add`** — remove rows only on the server first, then apply field changes for unchanged keys (e.g. `enabled`), then add rows only in desired state. Avoid **add-before-delete** on the same domain when the answer changes (transient overlap / ambiguity).

## Paths used (Step 2.2)

| Area | Paths |
|------|--------|
| Status | `GET /control/status` |
| Upstream DNS | `GET /control/dns_info`, `POST /control/dns_config` |
| Rewrites | `GET /control/rewrite/list`, `POST /control/rewrite/add`, `POST /control/rewrite/delete`, `PUT /control/rewrite/update` |

`rewrite/settings` is **not** implemented in Step 2.2.

## Errors (§2.3)

- **Network / timeout:** errors from `do` / `Client.do` (no response) are returned as wrapped errors; they are **not** `ErrHTTPUnauthorized` / `ErrHTTPForbidden`.
- **HTTP:** `401` → `ErrHTTPUnauthorized`; `403` → `ErrHTTPForbidden`; other non-2xx → `*HTTPStatusError` (see `HTTPStatusCode`).
- **2xx invalid JSON:** `*ErrJSONDecode` (`IsJSONDecodeError`).
- Helpers: `IsHTTPUnauthorized`, `IsHTTPForbidden`, `IsJSONDecodeError`, `HTTPStatusCode`.

Do **not** put passwords or full tokens in error strings.

## Bearer and `WithAllowBearerForProxy`

Official AdGH OpenAPI does not contract `Authorization: Bearer` for stock installs. By default, `AuthKind=bearer` **fails at `NewClient`** unless **`WithAllowBearerForProxy()`** is set (reverse proxy or ops convention that terminates Bearer). See API doc **DNSFleet 与 Node.AuthKind**.
