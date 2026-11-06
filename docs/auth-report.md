# Evidence 4 · Authentication System Implementation Report

| Field | Details |
| :--- | :--- |
| **Course** | Desarrollo Web Integral (IDGSBIS91N) · SD2026 |
| **Project** | **CuentasClaras (MonkyMoney)** — Group Expense Splitting & Debt Settlement Platform |
| **Repository** | `https://github.com/BeltranDev46/MonkyMoney` |
| **Live Frontend (Vercel)** | `https://monkeymoney-eta.vercel.app` |
| **Live Backend (Render)** | `https://cuentasclaras-backend-u28f.onrender.com` |
| **Document Path** | `docs/auth-report.md` |

---

## 1. Authentication Mechanism

### What We Used and Why
**CuentasClaras (MonkyMoney)** implements a **Backend-for-Frontend (BFF) Authentication Architecture** combining **Supabase Auth** (as an external identity microservice), **OAuth 2.0 with PKCE (`S256`) for Sign in with Google**, **asymmetric `ES256` JSON Web Tokens (JWTs)**, and **first-party `HttpOnly` cookies** — complemented by **Bearer JWT / API Key authentication (`HS256`)** for internal service-to-service calls to our currency conversion microservice (`cuentasclaras-fx-microservice`).

We chose this hybrid design to solve three real security problems found in typical Single-Page Applications (SPAs):
1. **Zero Token Exposure to Browser JavaScript (`HttpOnly` Cookies vs. `localStorage`)**: Instead of importing `@supabase/supabase-js` in React and storing raw JWTs in `localStorage` (where any XSS vulnerability could exfiltrate session tokens), our React frontend has **zero authentication SDKs and zero environment variables**. All auth flows execute exclusively on our Express backend (`backend/src/routes/auth.js`), which stores the tokens in `HttpOnly; Secure; SameSite=Lax` cookies.
2. **Stateless Asymmetric Verification via JWKS (`ES256`)**: Every protected request is verified cryptographically in `backend/src/middleware/requireAuth.js` using `jose` (`createRemoteJWKSet` + `jwtVerify`) against Supabase Auth's public Elliptic Curve P-256 keys (`/.well-known/jwks.json`). Our backend verifies token authenticity without storing a shared symmetric secret or querying the database on every request.
3. **Database-Level Defense in Depth (PostgreSQL RLS)**: Even though all queries pass through our Express backend (`owner_id = req.user.id`), all four PostgreSQL tables (`groups`, `members`, `transactions`, `transaction_splits`) enforce **Row Level Security (RLS)** tied to `auth.users(id)`.

### Own Authentication Microservice vs. Third-Party Identity Service

| Dimension | Own Auth Microservice *(e.g., `cuentasclaras-fx-microservice` `/auth/token` or `labbook-auth-service`)* | Third-Party Identity Service *(Supabase Auth + Sign in with Google OAuth 2.0)* |
| :--- | :--- | :--- |
| **Implementation Effort** | **Cons**: Must build and maintain password hashing (`scrypt`/`argon2`), email verification, password reset flows, OAuth provider integrations, and key rotation from scratch. | **Pros**: Production-hardened email/password, OAuth 2.0 PKCE with Google, asymmetric `ES256` JWKS key management, and rate-limited auth endpoints out of the box. |
| **Security & Cryptography** | **Cons**: Higher risk of subtle implementation flaws (timing attacks, weak reset tokens, symmetric `HS256` secret leakage). **Pros**: Full control over custom claims and audit logic. | **Pros**: Asymmetric `ES256` signing (`/.well-known/jwks.json`), battle-tested PKCE (`S256`) flow, and Google's multi-factor / phishing-resistant login protections. |
| **Control & Vendor Lock-In** | **Pros**: Zero vendor lock-in; works identically on any self-hosted PostgreSQL or cloud provider. | **Cons**: Coupled to Supabase Auth's `/auth/v1` API and Google Cloud OAuth credentials; subject to provider rate limits and availability. |
| **Cost & Operations** | **Pros**: No external per-MAU licensing fees. **Cons**: Higher engineering maintenance cost. | **Pros**: Free up to 50,000 MAUs on Supabase; minimal operational overhead for a small development team. |

> **Architectural Decision in CuentasClaras**: We use **Supabase Auth + Sign in with Google** (wrapped behind our Express BFF) for **end-user identity**, where password security and social login matter most, while implementing **our own lightweight `HS256` JWT / Bearer authentication** inside `cuentasclaras-fx-microservice` (`POST /api/v1/auth/token`) for **machine-to-machine** communication between backend services.

---

## 2. Authentication & Protected Request Flows

### 2.1 Login Sequence Diagram (Sign in with Google OAuth 2.0 PKCE & Email/Password)

```mermaid
sequenceDiagram
    autonumber
    actor User as End User (Browser)
    participant FE as React SPA + Vercel Edge (/api/*)
    participant BE as Main Backend (Express :3001)
    participant SA as Supabase Auth (/auth/v1)
    participant GG as Google OAuth 2.0

    rect rgb(240, 246, 255)
    Note over User,GG: Flow A — Sign in with Google (Server-Side OAuth 2.0 + PKCE S256)
    User->>FE: Click "Continuar con Google" (GET /api/auth/google)
    FE->>BE: Proxy GET /api/auth/google
    BE->>BE: Generate PKCE code_verifier & S256 code_challenge
    BE-->>User: 302 Redirect to Supabase Authorize + Set-Cookie: sb_pkce_state (HttpOnly, 5m)
    User->>SA: GET /auth/v1/authorize?provider=google&code_challenge=...
    SA-->>User: 302 Redirect to accounts.google.com
    User->>GG: Authenticate & grant consent (openid, email, profile)
    GG-->>SA: Redirect with Google authorization code
    SA->>SA: Upsert user in auth.users & issue one-time PKCE auth code
    SA-->>FE: 302 Redirect to /api/auth/callback?code=...
    FE->>BE: Proxy GET /api/auth/callback?code=... (with Cookie: sb_pkce_state)
    BE->>SA: POST exchangeCodeForSession(code, code_verifier)
    SA-->>BE: 200 OK { access_token (ES256 JWT), refresh_token, user }
    BE-->>User: 302 Redirect to /app + Set-Cookie: sb_access_token, sb_refresh_token (HttpOnly, Secure, SameSite=Lax) + Clear sb_pkce_state
    end

    rect rgb(242, 252, 245)
    Note over User,SA: Flow B — Email & Password Login
    User->>FE: Submit Login Form (POST /api/auth/login { email, password })
    FE->>BE: Proxy POST /api/auth/login
    BE->>SA: signInWithPassword({ email, password }) over HTTPS
    SA-->>BE: 200 OK { access_token (ES256 JWT), refresh_token, user }
    BE-->>FE: 200 OK { user: { id, email } } + Set-Cookie: sb_access_token, sb_refresh_token (HttpOnly)
    FE->>User: Navigate to /app Dashboard
    end
```

### 2.2 Protected Request Sequence Diagram (With Silent Token Renewal)

```mermaid
sequenceDiagram
    autonumber
    actor User as End User (Browser)
    participant FE as React SPA + Vercel Edge
    participant MW as Express requireAuth Middleware
    participant JWKS as Supabase JWKS (/.well-known/jwks.json)
    participant DB as Supabase PostgreSQL (Session Pooler)

    User->>FE: Open Dashboard / Create Expense (GET /api/groups)
    FE->>MW: GET /api/groups (Cookie: sb_access_token, sb_refresh_token)
    MW->>JWKS: Fetch & cache public EC P-256 key (kid match)
    JWKS-->>MW: Public JWK (ES256)
    MW->>MW: jwtVerify(sb_access_token, jwks, { issuer })

    alt Access Token Valid & Unexpired
        MW->>MW: Verify sub != null, role == "authenticated", is_anonymous != true
        MW->>DB: SELECT groups, members, transactions WHERE owner_id = $1 (req.user.id)
        DB-->>MW: Rows owned by authenticated user
        MW-->>FE: 200 OK [ { id, name, members, transactions } ]
    else Access Token Expired (ERR_JWT_EXPIRED) & Refresh Token Present
        MW->>JWKS: POST /auth/v1/token (refreshSession with sb_refresh_token)
        JWKS-->>MW: New { access_token, refresh_token }
        MW->>MW: jwtVerify(new_access_token, jwks, { issuer })
        MW->>DB: SELECT groups WHERE owner_id = $1
        DB-->>MW: Rows owned by authenticated user
        MW-->>FE: 200 OK + Rotated Set-Cookie (sb_access_token, sb_refresh_token)
    else Missing or Tampered Token
        MW-->>FE: 401 Unauthorized { code: "UNAUTHORIZED" | "INVALID_TOKEN" } + Clear Cookies
        FE->>User: Redirect via <ProtectedRoute /> to /login
    end
```

---

## 3. Token & Session Specification

### 3.1 JWT Structure & Claims (`ES256`)
Tokens issued by Supabase Auth and validated by `backend/src/middleware/requireAuth.js` use **asymmetric Elliptic Curve Digital Signature Algorithm (`ES256`, P-256)**:

- **Decoded JWT Header**:
  ```json
  {
    "alg": "ES256",
    "kid": "a7765348-4ac6-4fbf-a870-a6d770bc9528",
    "typ": "JWT"
  }
  ```
- **Decoded JWT Payload (Claims Used by Our Backend)**:
  ```json
  {
    "iss": "https://qwqklyfbdrinwwddzzeg.supabase.co/auth/v1",
    "sub": "11111111-2222-4333-8444-555555555555",
    "aud": "authenticated",
    "role": "authenticated",
    "email": "user@example.com",
    "is_anonymous": false,
    "iat": 1793923200,
    "exp": 1793926800
  }
  ```

| Claim | Purpose & Validation Rule in `requireAuth.js` |
| :--- | :--- |
| `alg` & `kid` | Selects the matching P-256 public key from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`; prevents algorithm confusion attacks. |
| `iss` | Must strictly equal `https://qwqklyfbdrinwwddzzeg.supabase.co/auth/v1`. |
| `sub` | Immutable UUID (`auth.users.id`) mapped to `req.user.id` and `public.groups.owner_id`. |
| `role` | Must equal `"authenticated"`. |
| `is_anonymous` | Explicitly rejected (`403 FORBIDDEN`) if `true`, ensuring only registered accounts access `/api/groups` and `/api/fx`. |
| `iat` / `exp` | Enforces token lifetime (`3600` seconds = **1 hour**). |
| `user_metadata` | **Explicitly ignored for authorization** because end users can mutate `raw_user_meta_data` in Supabase. |

*(For internal backend-to-microservice calls in `cuentasclaras-fx-microservice`, `POST /api/v1/auth/token` issues an `HS256` JWT with `iss: "cuentasclaras-fx-microservice"`, `sub: "cuentasclaras-main-app"`, `scope: "conversions:read conversions:write"`, and `exp: iat + 3600`.)*

### 3.2 Cookie Storage, Expiry, Renewal & Logout Strategy

| Cookie Name | Purpose | Path | Cookie `Max-Age` | Flags |
| :--- | :--- | :--- | :--- | :--- |
| `sb_access_token` | Carries the short-lived `ES256` JWT (internal `exp` = **1 hour**). | `/api` | 7 days *(envelope)* | `HttpOnly; Secure; SameSite=Lax` |
| `sb_refresh_token` | Single-use opaque refresh token used only by the server when `sb_access_token` expires. | `/api` | 30 days | `HttpOnly; Secure; SameSite=Lax` |
| `sb_pkce_state` | Ephemeral dictionary storing the PKCE `code_verifier` during Google OAuth redirect. | `/api/auth` | **5 minutes** | `HttpOnly; Secure; SameSite=Lax` |

- **Renewal Strategy**: Although the cookie envelope persists for 7 days so the browser continues sending it after an idle tab, `jwtVerify()` strictly enforces the JWT's internal 1-hour `exp` claim. When `ERR_JWT_EXPIRED` is caught in `requireAuth.js`, the server calls `supabase.auth.refreshSession({ refresh_token })`, verifies the newly minted JWT against JWKS, and overwrites both `sb_access_token` and `sb_refresh_token` cookies transparently in the same HTTP response.
- **Logout Strategy (`POST /api/auth/logout`)**: Implements **two-layer session termination**:
  1. **Server-side revocation**: Sends `POST ${SUPABASE_URL}/auth/v1/logout` with the user's `Bearer` access token so Supabase revokes the session and invalidates its refresh token family.
  2. **Client-side cookie destruction**: Calls `clearSessionCookies(res)` (`res.clearCookie` on `/api`) regardless of upstream network outcome, guaranteeing the browser immediately drops credentials.

---

## 4. System Architecture & Inter-Service Contracts

### 4.1 Component Diagram

```mermaid
flowchart TB
    subgraph Client["Browser Client"]
        SPA["React 18 + Vite SPA (LoginPage, ProtectedRoute, DashboardPage)"]
    end

    subgraph Edge["Vercel Cloud (monkeymoney-eta.vercel.app)"]
        VR["Vercel Static Hosting + Edge Rewrites (/api/:path*)"]
    end

    subgraph RenderCloud["Render Cloud"]
        BE["Main Backend API (Node.js + Express :3001)"]
        FX["FX Currency Microservice (Node.js + Express :4001)"]
    end

    subgraph External["Managed Identity, Database & Third-Party APIs"]
        SA["Supabase Auth (/auth/v1 + JWKS ES256)"]
        GOOG["Google OAuth 2.0 Identity Provider"]
        PG["Supabase PostgreSQL 17 (Session Pooler + RLS)"]
        FRANK["Frankfurter Exchange Rate API (ECB Data)"]
    end

    SPA <-->|"HTTPS First-Party Requests + HttpOnly Cookies"| VR
    VR <-->|"HTTPS Reverse Proxy /api/*"| BE
    BE <-->|"OAuth PKCE / Login / Refresh / JWKS"| SA
    SA <-->|"OAuth 2.0 Authorization Code"| GOOG
    BE <-->|"TLS Pool (pg) + Parameterized SQL"| PG
    BE <-->|"HTTPS REST + Authorization: Bearer + X-User-Id"| FX
    FX <-->|"HTTPS GET /currencies & /latest (10m Cache)"| FRANK
```

### 4.2 Endpoints & Data Exchanged Between Component Pairs

| Caller → Receiver | Endpoint(s) | Auth Mechanism | Data Sent / Returned |
| :--- | :--- | :--- | :--- |
| **Browser SPA → Vercel / Main Backend** | `POST /api/auth/signup`<br>`POST /api/auth/login`<br>`GET /api/auth/google`<br>`GET /api/auth/callback`<br>`POST /api/auth/logout`<br>`GET /api/auth/me` | `HttpOnly; Secure; SameSite=Lax` cookies (`sb_access_token`, `sb_refresh_token`) | **In**: `{ email, password }` (once on login/signup) or OAuth `?code`.<br>**Out**: `{ user: { id, email } }` + `Set-Cookie` headers. Never returns raw tokens in JSON body to browser JS. |
| **Browser SPA → Main Backend** | `GET /api/groups`<br>`POST /api/groups`<br>`POST /api/groups/:id/members`<br>`POST /api/groups/:id/expenses`<br>`POST /api/groups/:id/settlements`<br>`DELETE /api/groups/:id/transactions/:txId` | `HttpOnly` cookie verified by `requireAuth` (`ES256` JWKS) | **In**: Group names, member names, expense amounts, equal/exact splits.<br>**Out**: JSON group trees scoped strictly to `owner_id = req.user.id`. |
| **Browser SPA → Main Backend** | `GET /api/fx/currencies`<br>`GET /api/fx/rates`<br>`POST /api/fx/conversions`<br>`GET /api/fx/conversions`<br>`DELETE /api/fx/conversions/:id` | `HttpOnly` cookie verified by `requireAuth` | **In**: `{ amount, from, to: "MXN", participants, concept }`.<br>**Out**: `{ id, convertedAmount, rate, rateDate, perPersonAmount }`. |
| **Main Backend → Supabase Auth** | `GET /auth/v1/.well-known/jwks.json`<br>`GET /auth/v1/settings`<br>`POST /auth/v1/token`<br>`POST /auth/v1/logout` | `apikey: SUPABASE_KEY` (server-side env var only) + PKCE `code_verifier` | **In**: Credentials, PKCE code, or refresh token.<br>**Out**: Public JWK set (`ES256`) or session tokens. |
| **Main Backend → PostgreSQL** | TCP Port `5432` (`*.pooler.supabase.com`) | TLS + Pooler DB credentials (`DATABASE_URL` in server env) | Parameterized SQL (`$1, $2`) over `public.groups`, `members`, `transactions`, `transaction_splits` with RLS enabled. |
| **Main Backend → FX Microservice** | `GET /api/v1/currencies`<br>`POST /api/v1/conversions`<br>`GET /api/v1/conversions`<br>`DELETE /api/v1/conversions/:id` | `Authorization: Bearer <FX_SERVICE_API_KEY \| HS256 JWT>` + `X-User-Id` | **In**: Sanitized user UUID (`X-User-Id`) and currency conversion payload (no emails or passwords).<br>**Out**: Conversion quote JSON or structured `{ code, error }`. |
| **FX Microservice → Frankfurter API** | `GET https://api.frankfurter.dev/v1/currencies`<br>`GET https://api.frankfurter.dev/v1/latest` | Public HTTPS (`AbortSignal.timeout`) | **In**: ISO 4217 currency codes (`USD`, `MXN`, `EUR`). Zero personal data.<br>**Out**: Official ECB reference rates cached in memory for 10 minutes. |

---

## 5. Failure Modes & Resilience Analysis

| Failing Component | Runtime Impact | Concrete Mitigation Implemented in Code | User-Facing Behavior |
| :--- | :--- | :--- | :--- |
| **Supabase Auth or Google OAuth Down** | New logins, signups, OAuth callbacks, and expired-token refreshes cannot complete. | 1. `jose` `createRemoteJWKSet` caches the `ES256` public keys in memory, so **existing sessions with unexpired JWTs continue working** without calling Supabase Auth.<br>2. `/api/auth/google` pre-checks provider availability and catches errors, redirecting to `/login?error=...` instead of exposing raw JSON.<br>3. `/api/auth/logout` still clears local `HttpOnly` cookies inside a `try/catch` even if remote revocation fails. | Active users keep working until their 1h access token expires; new logins see a clean Spanish error banner on `/login`. |
| **PostgreSQL Database / Pooler Down** | Group & expense CRUD queries fail or time out. | 1. `connectionTimeoutMillis: 8000`, `idleTimeoutMillis: 30000`, and `keepAlive: true` in `backend/src/db.js`.<br>2. `pool.on('error', ...)` catches idle pooler disconnects so the Node.js process on Render never crashes.<br>3. Multi-statement writes (`POST /groups`, `POST /expenses`) execute `ROLLBACK` in `catch` blocks.<br>4. Global error middleware hides internal DB hostnames/stack traces. | Dashboard stays mounted, displays a non-crashing error alert with a **"Reintentar"** button, and preserves session state. |
| **FX Microservice Cold-Start or Down** | Live multi-currency conversion is delayed or unavailable. | 1. `fxClient.js` uses `AbortSignal.timeout(45000)` to absorb ~30s Render free-tier cold starts.<br>2. Network failures map to `503 FX_SERVICE_UNAVAILABLE` (`expose: true`).<br>3. `CurrencyConverterBox.jsx` preloads `FALLBACK_CURRENCIES` locally and isolates `fxError` inside the converter widget. | Core expense creation, equal/exact bill splitting, and debt settlements in `MXN` continue working 100% normally. |
| **Frankfurter Third-Party API Down** | Fresh exchange rates cannot be fetched upstream. | 1. 10-minute in-memory cache in `cuentasclaras-fx-microservice` serves cached currencies/rates.<br>2. Upstream timeouts return `504 Gateway Timeout` and upstream HTTP errors return `502 Bad Gateway` with structured JSON (no stack traces). | Converter widget displays a clean message asking the user to retry or enter the `MXN` amount manually. |

---

## 6. Security Analysis Mapped to OWASP Top 10:2025

| OWASP Top 10:2025 Category | Mitigations Applied in CuentasClaras | Remaining Risks & Future Hardening |
| :--- | :--- | :--- |
| **A01:2025 – Broken Access Control** *(incl. BOLA & SSRF)* | • Every `/api/groups` and `/api/fx` route is gated by `requireAuth`.<br>• All SQL queries enforce `WHERE owner_id = $1` (`req.user.id`) via `assertGroupOwnership()`.<br>• PostgreSQL **Row Level Security (RLS)** enabled across all 4 tables with 16 `TO authenticated` policies.<br>• Strict origin normalization (`new URL().origin`) prevents Open Redirects and SSRF on `FX_SERVICE_URL` / `FRONTEND_URL`. | Group collaboration currently scopes ownership to the creator (`owner_id`); adding shared multi-user group invites will require a `group_collaborators` join table in RLS. |
| **A02:2025 – Security Misconfiguration** | • `app.disable('x-powered-by')` and security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`).<br>• Strict CORS allowlist (`getAllowedOrigins()`) — wildcard `*` is never used with `credentials: true`.<br>• `.env` excluded via `.gitignore`; zero secrets in `frontend/`. | Add a strict `Content-Security-Policy (CSP)` header on Vercel `vercel.json` to further harden browser script execution. |
| **A03:2025 – Software Supply Chain Failures** | • Exact version pinning (`--save-exact`) on security-critical packages (`@supabase/supabase-js@2.119.0`, `jose@6.2.15`, `cookie-parser@1.4.7`, `react-router-dom@7.18.5`).<br>• Committed `package-lock.json` deployed with deterministic `npm ci` in `render.yaml` (`0` npm audit vulnerabilities). | Enable automated GitHub Dependabot / `npm audit` CI checks on every pull request. |
| **A04:2025 – Cryptographic Failures** | • End-to-end HTTPS/TLS across Browser ↔ Vercel ↔ Render ↔ Supabase Pooler (`ssl: { rejectUnauthorized: false }` over TLS).<br>• Asymmetric `ES256` (ECDSA P-256) JWT verification via JWKS.<br>• PKCE with `S256` SHA-256 code challenge for Google OAuth.<br>• Constant-time secret comparison (`crypto.timingSafeEqual`) in microservice auth. | Enable full CA certificate pinning (`sslmode=verify-full` with Supabase root CA bundle) in `pg.Pool` for strict MITM protection on DB connections. |
| **A05:2025 – Injection** | • 100% parameterized SQL queries (`$1, $2`, `ANY($1::uuid[])`) in `backend/src/routes/groups.js` — zero string concatenation in SQL.<br>• `express.json({ limit: '256kb' })` payload size cap and strict numeric/string input validation. | Adopt schema validation middleware (e.g., `zod`) across all request bodies in the main backend for uniform field-level validation. |
| **A06:2025 – Insecure Design** | • BFF Cookie pattern eliminates SPA token storage in `localStorage`/`sessionStorage`.<br>• Vercel `/api/:path*` rewrite keeps cookies first-party (`SameSite=Lax`), avoiding insecure `SameSite=None` cross-site cookies.<br>• Never trusts user-editable `user_metadata` JWT claims. | Add explicit CSRF double-submit token or `Sec-Fetch-Site` / `Origin` header check on state-changing `POST`/`DELETE` routes as extra defense beyond `SameSite=Lax`. |
| **A07:2025 – Authentication Failures** | • Delegated password hashing & Google OAuth 2.0 PKCE to Supabase Auth.<br>• Short-lived JWTs (1h) + server-side refresh rotation + explicit remote logout revocation.<br>• Anonymous tokens (`is_anonymous === true`) rejected with `403 FORBIDDEN`. | **Remaining Risk**: `/api/auth/login` and `/api/auth/signup` lack per-IP rate limiting at the Express layer (currently relying on Supabase Auth's upstream rate limits). Add `express-rate-limit`. |
| **A08:2025 – Software or Data Integrity Failures** | • Every incoming cookie token (including freshly refreshed tokens!) is cryptographically verified with `jwtVerify` checking signature, `alg`, `iss`, and `exp` before populating `req.user`. | Sign git commits/tags and add CI build provenance checks prior to production deploys. |
| **A09:2025 – Security Logging and Alerting Failures** | • Server logs auth/DB errors (`[Backend Error]`, `[Google OAuth Callback Error]`) on Render stdout without leaking sensitive payloads or stack traces to HTTP clients. | **Remaining Risk**: No automated alerting/SIEM webhook on repeated `401 INVALID_TOKEN` or brute-force spikes. Integrate structured JSON logging + alert thresholds. |
| **A10:2025 – Mishandling of Exceptional Conditions** | • Explicit `AbortSignal.timeout` on upstream microservice calls, SQL `BEGIN`/`ROLLBACK`/`finally { client.release() }` blocks, `pool.on('error')` idle handler, and centralized Express error middleware returning deterministic `{ code, error }` JSON. | Add circuit-breaker state around `fxClient.js` so repeated upstream timeouts fail fast instead of waiting during prolonged outages. |

---

## 7. Verification & Reproducible Evidence

All tests below run directly against the code in **`https://github.com/BeltranDev46/MonkyMoney`** and its live deployments without exposing any real passwords or production secrets.

### 7.1 Automated Integration Test Suite (`backend/tests/auth.test.js`)
Anyone cloning the repository can verify the `ES256` JWKS verification, `401` vs `403` enforcement, silent `sb_refresh_token` rotation, `HttpOnly; Secure; SameSite=Lax` flags, and `/api/auth/logout` cookie clearing with zero external `.env` secrets required:

```bash
cd backend
npm test
```

**Verified Console Output:**
```text
> gastos-amigos-backend@0.1.0 test
> node --test tests/auth.test.js

▶ Authentication System & Protected Routes (JWKS ES256 + HttpOnly Cookies)
  ✔ 1. Rejects unauthenticated requests without HttpOnly cookie (401 UNAUTHORIZED) (27.80ms)
  ✔ 2. Rejects tampered or forged JWT signatures (401 INVALID_TOKEN) (10.48ms)
  ✔ 3. Rejects anonymous tokens with 403 FORBIDDEN (authorization vs authentication) (4.13ms)
  ✔ 4. Grants access on valid ES256 JWT in HttpOnly cookie (200 OK) (2.35ms)
  ✔ 5. Silently refreshes an expired access token using sb_refresh_token and rotates HttpOnly cookies (24.04ms)
  ✔ 6. Revokes remote session and clears HttpOnly cookies on POST /api/auth/logout (2.80ms)
✔ Authentication System & Protected Routes (JWKS ES256 + HttpOnly Cookies) (150.00ms)
ℹ tests 6 | suites 1 | pass 6 | fail 0
```

### 7.2 Live Production Verification (Vercel Edge → Render Backend → Supabase Auth)
Running `curl` directly against the deployed production application (`https://monkeymoney-eta.vercel.app`) confirms end-to-end PKCE cookie creation, security headers, and JWT route protection:

```bash
# 1. Initiate Google OAuth 2.0 PKCE flow on production
curl -sI https://monkeymoney-eta.vercel.app/api/auth/google

# 2. Call protected endpoint WITHOUT session cookie (returns 401 UNAUTHORIZED)
curl -i https://monkeymoney-eta.vercel.app/api/groups

# 3. Call protected endpoint WITH tampered JWT cookie (returns 401 INVALID_TOKEN)
curl -i -H "Cookie: sb_access_token=eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjMifQ.forged_sig" \
  https://monkeymoney-eta.vercel.app/api/groups
```

**Verified Live Production Output:**
```text
=== 1. Live Google OAuth PKCE Init (Vercel -> Render -> Supabase) ===
HTTP/2 302
location: https://qwqklyfbdrinwwddzzeg.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fmonkeymoney-eta.vercel.app%2Fapi%2Fauth%2Fcallback&code_challenge=sqeeE7iarVf4xS8yjTbT7CGTDUGZ1A6Iy7Yoer3oVvk&code_challenge_method=s256
set-cookie: sb_pkce_state=%7B...%7D; Max-Age=300; Path=/api/auth; HttpOnly; Secure; SameSite=Lax
x-content-type-options: nosniff
x-frame-options: DENY

=== 2. Protected Endpoint Without Cookie (401) ===
{"code":"UNAUTHORIZED","error":"Sesión requerida."} [HTTP 401]

=== 3. Protected Endpoint With Tampered JWT Cookie (401) ===
{"code":"INVALID_TOKEN","error":"Tu sesión expiró. Vuelve a iniciar sesión."} [HTTP 401]
```

### 7.3 PostgreSQL Row Level Security (RLS) Verification
Verified against the project's Supabase PostgreSQL instance (`npm run db:init`), confirming all four public tables enforce RLS alongside 16 active policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`):

```text
Tables: [
  { tablename: 'groups', rowsecurity: true },
  { tablename: 'members', rowsecurity: true },
  { tablename: 'transaction_splits', rowsecurity: true },
  { tablename: 'transactions', rowsecurity: true }
]
RLS Policies: [
  { tablename: 'groups', policies: 4 },
  { tablename: 'members', policies: 4 },
  { tablename: 'transaction_splits', policies: 4 },
  { tablename: 'transactions', policies: 4 }
]
```
