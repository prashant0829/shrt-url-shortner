# shrt — a production-grade URL shortener

A horizontally scalable URL shortener with click analytics: a **React** single page app, an **Express** API, **PostgreSQL** and **Redis** — all in plain **JavaScript**. It is built the way a real service would be: a cache-first redirect path, asynchronous click processing, rate limiting, observability, containerised deployment and a serious automated test suite.

|                                            Dashboard                                             |                                                            Analytics                                                             |
| :----------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------------------------: |
| ![Dashboard listing links with status, click counts and actions](docs/screenshots/dashboard.png) | ![Analytics dialog with a clicks chart and country, browser, OS, device and referrer breakdowns](docs/screenshots/analytics.png) |

> 📖 **New to Docker, nginx or Redis?** Read the illustrated beginner's guide: [How it works](docs/HOW-IT-WORKS.md).

## Features

- **Short links** — generated 7-character base62 codes or custom aliases, optional expiry, enable/disable, soft delete (a deleted code is never reused), edit destination, QR codes (PNG/SVG).
- **Accounts** — register/login with scrypt-hashed passwords and short-lived JWTs; anonymous link creation is allowed with a stricter rate limit.
- **Click analytics** — clicks over time (hourly/daily, empty buckets filled), unique visitors, countries, browsers, operating systems, devices and referrers. Bots are detected and excluded by default.
- **Fast redirects** — Redis cache-aside with negative caching and request coalescing; Postgres is only touched on a cache miss.
- **Asynchronous ingestion** — a redirect only appends an event to a Redis Stream; a separate worker batch-inserts into Postgres with idempotent writes.
- **Safe by default** — destination validation (no private/loopback/metadata addresses, no credentials in URLs, no redirect loops), per-IP/per-user rate limiting, strict security headers, no stack traces in errors, raw IPs never stored.
- **Operable** — structured JSON logs with request ids, Prometheus metrics, liveness/readiness probes, graceful shutdown, and an **OpenAPI 3.1** document generated from the same schemas that validate requests (Swagger UI at `/docs`).
- **React UI** — sign up, create links, search and manage them, and explore analytics with a chart; accessible (native dialogs, labelled controls, live regions) and XSS-safe by construction.

## Architecture

```mermaid
flowchart LR
    C([Browser / API client]) --> N[nginx]
    N --> A1[Express API 1<br/>+ React bundle]
    N --> A2[Express API 2<br/>+ React bundle]
    A1 & A2 <-->|"link cache, rate limits"| R[("Redis")]
    A1 & A2 -->|"XADD click event"| R
    A1 & A2 <-->|"cache miss, link CRUD, reports"| P[("PostgreSQL")]
    W[Click worker] -->|"XREADGROUP + XACK"| R
    W -->|"batch INSERT (idempotent)"| P
```

**Redirect (the hot path)** — `GET /:code`

1. Validate the code shape (junk is rejected without touching any store).
2. Look up `link:{code}` in Redis. On a miss, one Postgres query (collapsed across concurrent requests) repopulates the cache — also for _unknown_ codes, briefly, so scanning random codes never reaches the database.
3. Answer `302`, and fire-and-forget an event onto the stream. Analytics can never slow down or break a redirect.

**Click pipeline** — worker loop: read a batch → enrich (browser/OS/device/bot) → **one** `INSERT … ON CONFLICT DO NOTHING` that also bumps the link counter → `XACK`. Delivery is at-least-once; the unique event id makes the effect exactly-once.

**Layering** — routes (HTTP only) → services (business rules) → repositories/adapters (SQL, Redis). Services depend on small contracts (`LinkStore`, `LinkCache`, `ClickPublisher`, …, documented as JSDoc typedefs) wired together in one composition root ([`server/src/container.js`](server/src/container.js)), so the same code runs against in-memory fakes in unit tests and real infrastructure in integration tests.

## Tech stack

| Concern    | Choice                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Backend    | Node.js 24, **Express 5**, JavaScript (ESM) with JSDoc contracts                                   |
| Validation | zod 4 — one schema drives validation, response contracts and the OpenAPI document                  |
| Data       | PostgreSQL 17 (plain SQL migrations, `pg`), Redis 7 (cache, rate limits, Streams) via `ioredis` 5  |
| Auth       | `node:crypto` scrypt, `jose` JWT (HS256)                                                           |
| HTTP       | helmet, cors, express-rate-limit (Redis-backed), pino-http, swagger-ui-express, Prometheus client  |
| Frontend   | **React 19** + Vite 8, plain CSS, no state library (context + small hooks)                         |
| Quality    | Vitest (server and client), Testing Library, supertest, ESLint (+ jsx-a11y, react-hooks), Prettier |
| Operations | Docker (multi-stage, non-root), Docker Compose, nginx, GitHub Actions                              |

## Quick start

Requirements: Node.js ≥ 22.12 and Docker.

### Development (apps on your machine, databases in Docker)

```bash
npm run install:all                 # root tooling + server + client dependencies
cp server/.env.example server/.env
npm run infra:up                    # Postgres + Redis
npm run migrate

npm run dev:api                     # Express API on http://localhost:8080
npm run dev:worker                  # second terminal: turns clicks into analytics
npm run dev:web                     # third terminal: React on http://localhost:5173 (proxies /api to :8080)
```

To run the UI from the API itself (as in production): `npm run build` (writes the React build to `server/public`), then open <http://localhost:8080>. API docs: <http://localhost:8080/docs>.

### Full stack (2 API replicas behind nginx, worker, migrations)

```bash
docker compose up --build -d --wait
open http://localhost:8080
```

Try the API:

```bash
curl -s -X POST localhost:8080/api/v1/links -H 'content-type: application/json' \
  -d '{"url":"https://example.com/some/very/long/path"}'
# => {"code":"aB3xY9k","shortUrl":"http://localhost:8080/aB3xY9k", ...}
curl -i localhost:8080/aB3xY9k     # 302 Found, Location: https://example.com/...
```

Generate demo analytics for a link you own: `npm --prefix server run seed:clicks -- <code> 500 14` (then let the worker run).

## API overview

Full, interactive reference (generated from the code) at **`/docs`**.

| Method & path                          | Auth     | Purpose                                                                      |
| -------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `POST /api/v1/auth/register`           | –        | Create an account, returns a token                                           |
| `POST /api/v1/auth/login`              | –        | Exchange credentials for a token                                             |
| `GET /api/v1/auth/me`                  | required | Current account                                                              |
| `POST /api/v1/links`                   | optional | Create a link (`url`, `customAlias?`, `expiresAt?`)                          |
| `GET /api/v1/links`                    | required | List your links: newest first, keyset pagination (`cursor`), search (`q`)    |
| `GET/PATCH/DELETE /api/v1/links/:code` | required | Read, edit (destination / expiry / enabled), delete                          |
| `GET /api/v1/links/:code/analytics`    | required | Time series + breakdowns (`from`, `to`, `interval=hour\|day`, `includeBots`) |
| `GET /api/v1/links/:code/qr`           | –        | QR code (`format=png\|svg`, `size`)                                          |
| `GET /:code`                           | –        | The redirect: `302`, `404` unknown, `410` expired/disabled/deleted           |
| `GET /health/live` · `/health/ready`   | –        | Liveness · readiness (checks Postgres and Redis)                             |
| `GET /metrics`                         | –        | Prometheus metrics (blocked at the nginx edge)                               |

Errors always look like `{"error": {"code": "ALIAS_TAKEN", "message": "..."}, "requestId": "..."}`.

## Configuration

All configuration is environment variables, validated at startup (the process refuses to boot on a bad value). See [`server/.env.example`](server/.env.example) for the full annotated list.

| Variable                               | Default                 | Meaning                                                                              |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`, `REDIS_URL`            | required                | Data stores                                                                          |
| `JWT_SECRET` / `VISITOR_HASH_SECRET`   | required (≥ 32 / ≥ 16)  | Token signing key / key for hashing visitor IPs                                      |
| `BASE_URL`                             | `http://localhost:8080` | Public origin used to build short URLs                                               |
| `TRUST_PROXY_HOPS`                     | `0`                     | Reverse proxies in front of the app. Set it to the **real** number (see below)       |
| `WEB_DIR`                              | `server/public`         | Directory with the built React app                                                   |
| `BLOCKED_DOMAINS`                      | empty                   | Comma-separated domains that cannot be shortened                                     |
| `LINK_CACHE_TTL_SECONDS`               | `3600`                  | Cache lifetime of a link (+ up to 10% jitter)                                        |
| `RATE_LIMIT_*_PER_MINUTE`              | 300 / 20 / 120 / 10     | Default API / anonymous create / signed-in create / auth (register + login combined) |
| `WORKER_BATCH_SIZE`, `WORKER_BLOCK_MS` | `500`, `2000`           | Worker batching                                                                      |
| `GEO_COUNTRY_HEADER`                   | `cf-ipcountry`          | Header carrying the visitor's country (set by your CDN)                              |

## Design decisions and trade-offs

These are the choices worth discussing; each is small, deliberate and covered by tests.

### Backend

- **`302`, not `301`.** Browsers cache permanent redirects and would never call the service again, silently breaking click counts, edits, expiry and takedowns. The cost is one request per click, which the cache makes cheap.
- **Random base62 codes with a database uniqueness check** instead of a counter or hash. 62⁷ ≈ 3.5 trillion codes, generated from a CSPRNG with rejection sampling (no modulo bias), need no coordination between replicas and are unguessable; a collision is just a retry (odds per attempt are links ÷ 62⁷: about 1 in 3.5 million at a million links, 1 in 3,500 at a billion — and five attempts all failing at a billion links is ~10⁻¹⁸). The unique index is the source of truth; the code length can be raised long before the table nears 10¹⁰ rows.
- **Cache-aside with three protections.** _Negative caching_ (unknown codes cached for 60 s) blunts enumeration; _single-flight_ collapses N concurrent misses for one code into one query; _TTL jitter_ stops a burst of links expiring together. Expiry is evaluated per request against the cached row, so a TTL can never extend a link's life. Edits and deletes invalidate the key, and a failed invalidation surfaces as an error instead of serving stale data.
- **Graceful degradation.** Redis is treated as an optimisation: if it is down, redirects fall back to Postgres, click events are dropped and counted, and the rate limiter fails open. If Postgres is down, cached links keep redirecting. Readiness reports `503`, liveness stays `200` (a restart would not help). All of this is tested against a dead Redis.
- **Reliable, idempotent click ingestion.** At-least-once delivery from Redis Streams plus a unique `event_id` gives an exactly-once _effect_. A worker that fails retries its own unacknowledged batch immediately; entries abandoned by a crashed worker are reclaimed via `XAUTOCLAIM`; malformed events are acknowledged and dropped so they cannot block the queue; events for deleted links are ignored rather than failing the batch. The stream is length-capped so a dead worker cannot exhaust Redis memory, and the backlog is exported as a metric. Each worker keeps a heartbeat file that the container health check reads.
- **Analytics SQL that scales with the range, not the table.** One index range scan aggregates the buckets; `generate_series` + `LEFT JOIN` fills empty ones; all five breakdowns come from a single filtered pass. Requests are bounded (≤ 1,000 buckets). The per-link counter is denormalised for the list view and counts humans only, matching the default analytics view.
- **Destination policy.** Only `http(s)`; no embedded credentials; blocks loopback, private, link-local (cloud metadata), CGNAT and multicast ranges in every IPv4/IPv6 spelling (`2130706433`, `0x7f.1`, `[::ffff:127.0.0.1]`, …); blocks single-label hosts and `.local`/`.internal`; blocks the service's own host and a configurable domain blocklist.
- **Privacy.** Visitors are counted with a keyed hash of IP + user agent; the IP is never stored or queued. Only the referrer _host_ is kept.
- **Auth details.** scrypt (OWASP parameters, self-describing hash format so cost can be raised later), constant-time comparison, a dummy hash for unknown emails so response time does not reveal which accounts exist, bearer tokens (no cookies, so no CSRF), 1 h lifetime.
- **Soft delete.** A deleted code stays reserved, so an old printed QR code can never be re-pointed by someone else.

### Express specifics

- **Routes declare themselves.** Each route is one object — security, rate limit, input schemas, responses, docs — and [`route-kit.js`](server/src/http/route-kit.js) turns it into the middleware chain _and_ an entry in the OpenAPI document. Validation, behaviour and documentation cannot drift apart, and a test validates the generated document with a real OpenAPI parser.
- **Middleware order is a security feature.** `identify caller → rate limit → reject bad token → require login → parse body → validate → handler`. Rejecting a bad token _after_ the limiter means unauthenticated and bad-token requests are throttled too (a real hole the test suite caught). Rate limiting sits before body parsing, so floods are cut off before any work is done. Express runs middleware in registration order, so the catch-all `/:code` redirect is mounted last.
- **Proxy trust is a hop count, not a boolean.** `TRUST_PROXY_HOPS=1` makes Express read the client IP from the _right-most_ `X-Forwarded-For` entry — the one the nearest proxy added — so a client cannot spoof its address, even if a proxy appends instead of overwriting. nginx additionally overwrites the header. Verified against the running stack.
- **A self-healing Redis store for the rate limiter.** The off-the-shelf Redis store loads its Lua script at start-up; if Redis is briefly down then, rate limiting stays off until the next restart. A ~40-line store built on ioredis's `defineCommand` sends the script lazily and re-sends it if Redis forgets it (tested with `SCRIPT FLUSH`).
- **The UI is registered file by file.** A static mount on `/` would `stat()` the disk on every short-link click just to learn that `public/<code>` does not exist; instead the bundle's files are routed explicitly at start-up. Fingerprinted assets are cached for a year, `index.html` is always revalidated.
- **Draining on shutdown.** On `SIGTERM` the server answers in-flight requests with `Connection: close`, stops accepting new ones, then closes the pool and Redis — exits in under a second, code 0.
- **Express 5 conveniences used deliberately:** async handlers that throw reach the error middleware without wrappers; parsed input lives on `req.input` because `req.query` is read-only.

### Frontend

- **Plain React, small surface.** Context for auth, links and toasts; a few hooks; no state library and no router — short codes live at the URL root, so client-side routes would collide with them.
- **No stale responses.** `useAsync` stores each result with the key it belongs to and aborts the previous request (`AbortController`), so a slow answer can never overwrite a newer one; "loading" is derived, not set inside effects.
- **Native `<dialog>` for modals** — focus trapping, Escape-to-close and the backdrop for free. `eslint-plugin-jsx-a11y` runs in CI; toasts use a live region.
- **XSS-safe by construction.** React escapes text; `react/no-danger` is an error, a test scans the sources for `innerHTML`/`eval`, and a component test renders a hostile destination URL and checks it stays text.
- **Session handling.** The token lives in `localStorage` (simple, survives reloads; the strict Content-Security-Policy is the mitigation for XSS). An invalid or expired token signs the user out with an explanation.

### Plain JavaScript, on purpose

Without a compiler, correctness comes from other layers: zod validates every boundary (env, request bodies, stream events); JSDoc typedefs describe the contracts between modules (and give editors full autocompletion); `#private` fields enforce encapsulation at runtime; and the contract tests parse real API responses with the same strict schemas that generate the docs, so a leaked or missing field fails a test.

## Testing

```bash
npm run infra:up          # the server's integration tests need Postgres + Redis
npm test                  # server (345 tests, ~15 s) + client (72 tests)
npm --prefix server run test:unit          # no infrastructure needed
npm --prefix server run test:coverage      # ≈ 93% statements / branches
npm --prefix client run test:coverage      # ≈ 95% statements
npm run lint && npm run format:check
```

- **Server unit tests** (in-memory fakes): code generation, URL policy, password hashing, JWTs (tampering, `alg=none`, expiry), config validation, link service, redirect resolver (caching, single-flight, expiry), analytics rules, click enrichment, request validation and OpenAPI generation.
- **Server integration tests** (real Postgres and Redis, isolated test databases): repositories and the analytics SQL, the full click pipeline including crash/redelivery/reclaim/poison-message scenarios, the Redis rate-limit store, and every HTTP endpoint end to end — auth, ownership, pagination, caching, invalidation, rate limits, security headers, OpenAPI validity, metrics, response contracts, and the app running with Redis unavailable.
- **Client tests** (Vitest + Testing Library): the API client, hooks (including out-of-order responses), the chart, and full user flows against a fake API — sign up/in/out, session restore and expiry, creating links, search, paging, enable/disable/delete with confirmation, analytics ranges, XSS safety.
- **Mutation spot-check.** I deliberately broke ten critical behaviours one at a time (ownership check, idempotent insert, negative caching, private-address blocking, token rejection, cache invalidation, limiter ordering, request validation, proxy trust, error-message leaking); the suite failed for each.
- **Also verified against the Docker stack:** load balancing across replicas, failover when a replica stops, graceful shutdown (exit code 0 in under a second), `X-Forwarded-For` spoofing, `/metrics` blocked at the edge, and the UI and Swagger page in a real browser (no console errors).
- CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs server lint + tests with Postgres/Redis service containers, client lint + tests + build, formatting, and a Docker image build.

## Performance

Measured on a MacBook Air (Apple silicon) with [`npm --prefix server run loadtest`](server/scripts/loadtest.mjs) (autocannon, 100 connections, 10 s). The load generator, Node, and — for the last row — Docker's Linux VM all share the same laptop, so treat these as indicative, not as capacity numbers.

| Scenario                                         | Requests/sec | p50   | p99   |
| ------------------------------------------------ | -----------: | ----- | ----- |
| Redirect, one Node process, JSON request logs on |      ~17,300 | 5 ms  | 11 ms |
| Redirect, one Node process, `LOG_LEVEL=warn`     |      ~18,600 | 4 ms  | 11 ms |
| Create link (insert + cache write), one process  |       ~7,600 | 12 ms | 23 ms |
| Redirect, full Docker stack (nginx + 2 replicas) |      ~11,200 | 8 ms  | 43 ms |

The redirect path is served entirely from Redis; during the full-stack run the worker stored every one of the ~123,000 click events with no backlog. The Docker figure is lower mainly because Docker Desktop on macOS routes all traffic through a VM.

## Scaling further

| Bottleneck                       | Next step                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| API throughput                   | Add replicas (stateless). Connection pools are per process (`DB_POOL_MAX`): size them against Postgres `max_connections`, or add PgBouncer |
| Redirect latency worldwide       | Put a CDN/edge in front and cache the `302` for a few seconds — trading exact click counts and instant takedown for latency                |
| Postgres reads / writes          | Read replica for analytics queries; partition `clicks` by month (drop old partitions instead of deleting rows)                             |
| Analytics cost on very hot links | Roll clicks up into hourly/daily aggregate tables, written by the worker                                                                   |
| Redis memory / single node       | Redis Cluster or Sentinel; the stream key is the only one that must not be evicted (`volatile-lru` protects it)                            |
| Event volume                     | Add workers to the same consumer group (already supported), or swap the `ClickPublisher` for Kafka/SQS                                     |

## Project layout

```
server/                          Express API and click worker
  src/
    app.js · container.js        App assembly · composition root
    server.js · worker.js        Process entry points (API, click worker)
    config/                      Environment validation
    infra/                       Postgres pool, Redis clients, migration runner, metrics
    http/                        Route kit, validation, OpenAPI generator, Redis rate-limit store
      middleware/                Auth, rate limit, security, request context, metrics, errors, UI
    shared/                      Errors, logger, lifecycle, single-flight, shared schemas
    modules/
      auth/                      Register/login, scrypt hasher, JWT service
      links/                     Link CRUD, code generator, URL policy, cache adapter, QR
      redirect/                  GET /:code, cache-aside resolver, error pages
      analytics/                 Click tracker, stream publisher/consumer, enrichment, reports
      health/                    Liveness and readiness probes
  migrations/                    Plain SQL, applied in order inside transactions
  scripts/                       loadtest.mjs · seed-clicks.js
  test/                          unit/ · integration/ · helpers/
client/                          React single page app (Vite)
  src/
    api/                         Fetch wrapper (no React dependency)
    context/ · hooks/            Auth, links and toast state · data-loading hooks
    components/                  Dialogs, forms, list, analytics chart
    test/                        Fake API and render helpers
nginx/ · Dockerfile · docker-compose.yml · .github/workflows/ci.yml
```

## Known limitations

- Access tokens cannot be revoked before they expire (1 h); there is no refresh-token flow.
- Country comes from a CDN header (`GEO_COUNTRY_HEADER`) rather than an IP database, so it is "Unknown" without a CDN in front.
- Expired and deleted links remain in the database (by design, to keep codes reserved); there is no purge job for old clicks.
- The Prometheus endpoint is unauthenticated and relies on the network edge to keep it private.
- The client uses ESLint 9 because the React lint plugins do not support ESLint 10 yet.
