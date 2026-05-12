# Contributing to DNSFleet

Thanks for your interest—bug reports, doc fixes, and small PRs are welcome. DNSFleet is still early; this page is here to **share how we think about the product**, not to run a heavy governance process.

## What DNSFleet is trying to be

DNSFleet aims to be a **unified operational surface** for a **fleet of AdGuard Home** nodes: observe, investigate, and act from one console—especially **real-time** query visibility and **lightweight** fleet-wide configuration workflows.

We're **not** aiming for:

- A **1:1 clone** of the AdGuard Home web UI.
- **Full configuration parity** (every obscure settings panel).
- A **long-term log retention / SIEM** product (see the README: no durable fleet-wide querylog warehouse).

We're also **not** just a thin “fleet overlay” that sends you back to native UIs for every daily task. Where it clearly helps, **high-frequency** paths (live tail, node health, quick actions, shallow config) should **close the loop inside DNSFleet** and reduce friction.

## Questions that help shape ideas and reviews

When you're unsure whether something fits, these prompts are useful—not a formal gate you must pass:

1. **Unified operational surface** — Does this make day-to-day work **clearer inside DNSFleet** (especially across nodes or in real time)?
2. **Frequency** — Is this something operators hit **often**, or only in rare edge cases?
3. **Fewer forced jumps** — Does it **reduce how often** someone leaves DNSFleet for AdGuard Home or another tool to finish a task?  
   - This is **not** about maximizing screen time. It's about **fewer forced context switches** to complete a normal loop: observe → triage → act → observe.
4. **Fleet-shaped complexity** — If a change adds **non-trivial coordination, merging, or cross-node semantics**, it helps when the **fleet-level benefit** is easy to see—not duplicating what AdGuard Home already does well for a single node.

**Loose heuristic:** if AdGuard Home already covers something **very well** for one node and it's **weakly related to fleet context**, we often **defer** it—unless it clearly improves **operational closure** for a common path.

## Tier A / B / C — a simple mental model

The labels below are a **lightweight** way to think about scope; they're **not** a roadmap commitment.

| Tier | Intent | Examples (illustrative) |
|------|--------|-------------------------|
| **A** | **High-frequency ops & investigation** — extend usefulness *without* sprawl | Live tail quality, backpressure, node probe/recovery UX, cross-node visibility in the **current** in-memory window, small inline actions |
| **B** | **Medium-frequency, shallow control-plane work** | Desired-state style knobs, sync/drift clarity, docs, packaging, bilingual copy, performance of existing flows |
| **C** | **Low-frequency, obscure, or platform-like** — usually **out of scope** or **defer to AdGuard Home** | Rare DHCP edge panels, advanced grammar builders, multi-tenant RBAC, centralized log indexing, ELK/Loki-class pipelines |

**Operational closure ≠ platform sprawl:** keeping people in DNSFleet means **closing high-frequency loops**, not shipping **every** AdGuard Home screen.

## Where we're cautious (anti-goals)

These are **current product constraints and guiding principles** for the phase DNSFleet is in today—not a backlog of features we'll “get to later”:

- No **multi-tenant** complex RBAC (the v0.1.x model stays operator-sized).
- No **durable fleet-wide querylog warehouse** or centralized query “engine” replacing per-node truth at the edge.
- No **microservices / message queues** for the control plane in the current product phase.
- No **unfinished multi-DNS-engine** abstractions or unrelated resolver control planes (see README “Not a fit”).

**Large scope expansions are best discussed first** to keep the project focused—a short design note or GitHub discussion often saves rework.

## Engineering notes

- Small, reviewable PRs are easiest to merge; a one-line **intent** (bugfix / UX / rough Tier if you used the table) is plenty.
- Match existing **Go** and **web** style; run **`go fmt`**, **`go vet`**, **`go test`** on touched Go packages, and **`npm run lint && npm test && npm run build`** under `web/` when the console changes.
- First-run **CLI flags** (`-admin-token`, `-listen`) are optional onboarding helpers; see README. Prefer **environment variables** (or Compose) for production-style deployments.
- Please don't commit **secrets**, real **node credentials**, or **local-only** paths that belong in `.gitignore`.
- **CI:** changing `.github/workflows/` is sensitive—please check with maintainers first.

## Where things live

| Area | Path |
|------|------|
| Go entry | `cmd/dnsfleet/` |
| Application code | `internal/` |
| Web console | `web/` |
| Public HTTP API notes | `api/DNSFLEET_HTTP_API.md` |

---

If something feels big or fuzzy, opening a **discussion** with a few paragraphs of intent is always OK—we'd rather align early than rush a large PR.
