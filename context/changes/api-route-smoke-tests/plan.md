# API Route Smoke Tests Implementation Plan

## Overview

Add smoke-level Vitest coverage to the 11 API routes under `src/pages/api/` and to
`src/middleware.ts`, by importing each handler and invoking it directly with a
shared fake `APIContext`. The bar is: **the suite fails when a route stops
responding correctly**. This clears health-check Fix #2 and is the stated
prerequisite for the Astro 6 → 7 upgrade (Fix #1), which lands on exactly this
uncovered surface.

## Current State Analysis

37 tests live in two files (`src/lib/progress.test.ts`, `src/lib/utils.test.ts`),
both covering pure functions with **zero mocking**. Nothing covers
`src/pages/api/` (11 routes) or `src/middleware.ts` — the code where persistence,
auth, CSRF, and XP accrual actually happen.

The blocking unknown — *can an Astro API route be invoked under a Vitest config
that deliberately avoids Astro's Vite pipeline?* — was settled by
`research.md` with two executable probes: **yes, with no harness change**. Every
route imports `astro` type-only, so the Astro runtime never enters the module
graph. The only runtime virtual module reachable is `astro:env/server`, already
aliased at `vitest.config.ts:14`.

CI already runs `npm test` alongside `lint` and `typecheck`
(`.github/workflows/ci.yml:20-22`), so these tests become a PR gate the moment
they land.

## Desired End State

Every route under `src/pages/api/` and `src/middleware.ts` has at least one test
asserting its status code and response shape. A route that stops responding
correctly — because of the Astro 7 upgrade or anything else — fails CI.

Verify with `npm test` (all files green, count risen from 37), `npm run lint`,
and `npm run typecheck`.

### Key Discoveries:

- **Type-only Astro coupling is the load-bearing invariant.** All 11 routes open
  with `import type { APIRoute } from "astro"`. The day one uses a value-position
  import, direct invocation breaks. Phase 1 makes this a lint rule.
- **The env stub makes "unconfigured" the default state.**
  `vitest.astro-env-server.stub.ts:6-10` sets everything to `""`, so
  `createClient()` returns `null` (`src/lib/supabase.ts:7-9`) and
  `createAdminClient()` too (`src/lib/supabase-admin.ts:11-13`). Every route's
  degraded branch is reachable with **zero mocking**.
- **`AstroCookies` is a class with private fields**
  (`node_modules/astro/dist/core/cookies/cookies.d.ts:26`), so a structural fake
  cannot satisfy the type. A cast is unavoidable — centralize it in one helper.
- **Test files are linted and type-checked.** `tsconfig.json:3` includes `**/*`;
  `eslint.config.js` applies `strictTypeChecked` repo-wide with no test-file
  exemption. Mock objects must clear `no-unsafe-assignment` /
  `no-unsafe-member-access`. This is the real friction, not invocation.
- **`astro:middleware` exports exactly one symbol**, `defineMiddleware`
  (`node_modules/astro/dist/virtual-modules/middleware.d.ts:1`), so its stub is
  one line.
- **`resolveSiteOrigin` falls back to the request origin under test**
  (`src/lib/site-url.ts:13` — `import.meta.env.PROD` is false), so `oauth` and
  `reset-request` get a working origin for free; the fail-closed null branch
  needs `@/lib/site-url` mocked.
- **`signin`/`signup` do not validate input** (`signin.ts:8-9` casts
  `form.get("email") as string`), while `reset-request.ts:15` and
  `update-password.ts:12` do. The zero-mock validation tier exists for two auth
  routes, not four.
- **House style** (`src/lib/progress.test.ts:15-41`): explicit `describe`/`it`/
  `expect` imports despite `globals: true`; a header comment stating what the
  file locks down and why; small typed factory helpers over inline literals;
  comments explaining why fixture values were chosen.

## What We're NOT Doing

- **`grade.ts`'s happy path.** It needs ~11 mocked collaborators
  (`grade.ts:3-23`); such a test asserts the mock graph, not the code. Its real
  risk — retake XP arithmetic and unlock derivation — is already covered by
  `src/lib/progress.test.ts` and belongs in E2E thereafter. `grade.ts` gets its
  zero-mock 400/503 coverage only.
- **E2E / browser-level tests.** Per `CLAUDE.md`, those route through
  `/10x-e2e`.
- **Component tests** for the auth islands, and `src/db/` coverage. Health-check
  Fix #2 names them; this change deliberately stops at the route and middleware
  layer.
- **Changing any production code**, other than adding one scoped ESLint rule.
  No route behavior is modified to make it more testable.
- **Reworking `vitest.config.ts` to use `getViteConfig()`.** Research proved it
  unnecessary; Phase 3 adds one alias entry, nothing more.
- **The Astro 7 upgrade itself** (health-check Fix #1) — a separate change this
  one unblocks.

## Implementation Approach

Import each route's exported verb directly and call it with a hand-built context
object. One shared helper (`src/test/api-context.ts`) builds that context and
owns the necessary type casts, so the 12 test files stay clean.

Coverage is scoped to tiers A+B+C from the research cost analysis:

| Tier | What | Mocks |
|---|---|---|
| A | Validation 400s, the `delete-account` auth guard, every route's unconfigured branch | none |
| B | `quiz`/`lesson` 200 / 403 / 404 | 3 |
| C | 7 auth routes' success and error branches | 1–2 |

Phases slice **vertically by area**, so each phase ships complete test files and
is independently verifiable — rather than touching all 12 files twice.

Redirect assertions target the `Location` header, not the status code. The fake
`redirect` defaults to 302 to match Astro, but asserting on status would make the
fake's defaults load-bearing; `Location` is what the behavior actually is.

## Critical Implementation Details

**Mock factories must use `vi.fn()`.** Declaring a mock factory's members as
plain functions makes per-test overrides fail with
`vi.mocked(...).mockResolvedValueOnce is not a function` — research hit this
exact failure. Write `vi.fn(async () => …)` from the start, in every factory.

**Casts belong in the helper, not the tests.** `AstroCookies` is a class with
private state and `APIContext` has ~15 required members, so both fakes need
`as unknown as T`. Confining those two casts to `src/test/api-context.ts` keeps
the 12 test files free of them and keeps `strictTypeChecked` quiet at the call
sites.

**Never exercise real `readGuestScores`.** It uses `crypto.subtle`, which is not
reliably present under Vitest's jsdom environment. No in-scope test needs it —
routes only read the `GUEST_SCORES_COOKIE` constant, and the middleware merge
test mocks `@/lib/guest-progress`. If a future test reaches for it, that is the
signal to switch that file to the `node` environment, not to polyfill.

---

## Phase 1: Foundation + Game Routes

### Overview

Build the shared context helper, lock the type-only-`astro` invariant with a lint
rule, and cover the three `game/` routes. This phase establishes both patterns
the rest of the change repeats: zero-mock degraded-path assertions, and
`vi.mock` of `@/lib/*` collaborators. `quiz.ts` is the cleanest target for the
latter (`quiz.ts:15-47`: validate → client → gate → fetch → respond).

### Changes Required:

#### 1. Shared test context helper

**File**: `src/test/api-context.ts`

**Intent**: One factory that builds the fake `APIContext` all 12 test files use,
owning the two unavoidable type casts so no test file carries one. Not a `.test.ts`
file, so `vitest.config.ts:21`'s `include` glob won't collect it as a suite.

**Contract**: Exports `makeContext(overrides?)` returning an `APIContext`. The
overrides cover what routes actually touch (per research's context-surface
audit): `url` (string or `URL`), `locals.user`, request `method`, `headers`,
`body` (form or JSON), and initial cookie entries. Internally it provides:

- `cookies` — a `Map`-backed fake implementing `get`/`set`/`delete`/`has`, where
  `get` returns `{ value }` (the shape `?.value` call sites expect), cast to
  `AstroCookies`.
- `redirect(location, status = 302)` → `new Response(null, { status, headers: { Location: location } })`.
- `request` — a real `Request`, so `.formData()` and `.json()` are genuine.

Also export a small assertion helper for redirects (reads `Location` off a
`Response`), since 15+ assertions across Phase 2 need it.

#### 2. Type-only Astro import guard

**File**: `eslint.config.js`

**Intent**: The whole approach rests on routes never importing `astro` in value
position. Make that a lint error at the import site rather than an opaque test
failure later. Currently a no-op — all 11 routes already comply — so it locks in
the status quo.

**Contract**: A new scoped config block, composed into the exported
`tseslint.config(...)` array alongside the existing `astroConfig` /
`jsxA11yConfig` blocks. Scoped to `src/pages/api/**/*.ts`, using
`@typescript-eslint/no-restricted-imports` with `allowTypeImports: true` on the
`astro` specifier, and a `message` explaining the constraint and pointing at this
change.

#### 3. Quiz route tests

**File**: `src/pages/api/game/quiz.test.ts`

**Intent**: Cover the route's full branch set — the cheapest and highest-value
target in the change.

**Contract**: Tier A — 400 on missing `zoneSlug`, 503 when unconfigured. Tier B,
with `@/lib/supabase`, `@/lib/content`, `@/lib/progress` mocked — 403 on a locked
zone, 404 when no mission, 200 with `{ mission, questions }`. Cover both the
guest and authed arms of the `locals.user` split at `quiz.ts:29`.

#### 4. Lesson route tests

**File**: `src/pages/api/game/lesson.test.ts`

**Intent**: Same shape as quiz, with the one behavioral difference that matters.

**Contract**: Mirrors quiz's branch set, except the 404 is driven by
`!mission?.lesson` (`lesson.ts:36`) — a mission that exists with a null lesson
must still 404. That case is the reason this file is not a copy of quiz's.

#### 5. Grade route tests

**File**: `src/pages/api/game/grade.test.ts`

**Intent**: Zero-mock coverage only. Deliberately stops short of the happy path —
see "What We're NOT Doing".

**Contract**: 400 on a non-JSON body (`grade.ts:57-60`), 400 on a body failing
`bodySchema` (empty `answers`, missing `zoneSlug`), 503 when unconfigured. A
header comment states why the happy path is absent and where that risk is
covered instead.

### Success Criteria:

#### Automated Verification:

- Test suite passes: `npm test`
- Linting passes, including the new rule: `npm run lint`
- Type checking passes: `npm run typecheck`
- The new rule actually fires: temporarily add a value-position `astro` import to
  a route, confirm `npm run lint` errors, then revert
- `src/test/api-context.ts` is not collected as a test file (no "no test suite
  found" error in the `npm test` output)

#### Manual Verification:

- Breaking a route on purpose (e.g. change `quiz.ts`'s 403 to a 401) makes the
  suite fail with a message that names the route and the branch
- The helper's ergonomics hold up: writing a new case needs no cast and no
  boilerplate beyond `makeContext({ … })`

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to Phase 2. Phase 2 replicates this phase's patterns eight times —
getting the helper's shape right first is what keeps that cheap.

---

## Phase 2: Auth Routes

### Overview

Cover the eight routes under `src/pages/api/auth/`. All eight return redirects,
so assertions read the `Location` header. Tier A is free for all of them; Tier C
needs `@/lib/supabase` returning an object with a fake `auth` — the specific
method varies per route.

### Changes Required:

#### 1. Credential routes

**Files**: `src/pages/api/auth/signin.test.ts`, `src/pages/api/auth/signup.test.ts`

**Intent**: Cover the canonical auth shape (`signin.ts:6-22`): unconfigured,
provider error, success.

**Contract**: Three cases each — redirect to `?error=Supabase is not configured`
when unconfigured; redirect to `?error=<provider message>` when
`signInWithPassword` / `signUp` returns an error; redirect to `/` (signin) or
`/auth/confirm-email` (signup) on success. Mock `@/lib/supabase` with
`createClient: vi.fn(() => ({ auth: { signInWithPassword: vi.fn(…) } }))`.

Note in the header comment that neither route validates its form input
(`signin.ts:8-9` casts `form.get("email") as string`), so there is no 400-tier
case here — unlike `reset-request` and `update-password`.

#### 2. Session lifecycle routes

**Files**: `src/pages/api/auth/signout.test.ts`, `src/pages/api/auth/callback.test.ts`

**Intent**: `signout` has the unusual property of redirecting to `/` whether or
not a client exists (`signout.ts:8-11`) — worth locking so a future refactor
can't turn a missing client into an error page. `callback` carries the
zero-mock missing-code branch.

**Contract**: `signout` — redirects to `/` unconfigured; redirects to `/` after
calling `auth.signOut` when configured (assert the call happened). `callback` —
redirect with `error=Missing authorization code` when `?code` is absent
(zero-mock, `callback.ts:12-15`); unconfigured redirect; error redirect when
`exchangeCodeForSession` fails; redirect to `/` on success.

#### 3. Password routes

**Files**: `src/pages/api/auth/reset-request.test.ts`, `src/pages/api/auth/update-password.test.ts`

**Intent**: `reset-request`'s neutral-response property is a security behavior,
not an implementation detail — it must land on `?sent=1` even when the provider
throws (`reset-request.ts:28-35`). That is the single most valuable assertion in
this phase.

**Contract**: `reset-request` — `error=Email is required` on a missing/blank
email (zero-mock); unconfigured redirect; `?sent=1` on success; **`?sent=1` even
when `resetPasswordForEmail` rejects**; `?sent=1` when `resolveSiteOrigin`
returns null (mock `@/lib/site-url`, since the test-time fallback at
`site-url.ts:13` otherwise yields an origin). `update-password` — error redirect
on a password under 6 characters (zero-mock, `update-password.ts:12`);
unconfigured redirect; provider-error redirect; `/auth/signin?reset=1` on
success.

#### 4. OAuth start

**File**: `src/pages/api/auth/oauth.test.ts`

**Intent**: Cover the fail-closed origin guard, which is a security boundary
(`oauth.ts:17-20`), and the redirect to the provider URL.

**Contract**: Unconfigured redirect; `error=Sign-in is temporarily unavailable`
when `resolveSiteOrigin` returns null (mock `@/lib/site-url`); error redirect
when `signInWithOAuth` errors **or returns no `data.url`** (both arms of
`oauth.ts:28`); redirect to `data.url` on success. Assert that the `redirectTo`
passed to `signInWithOAuth` is built from the resolved origin, not the request
host.

#### 5. Account deletion

**File**: `src/pages/api/auth/delete-account.test.ts`

**Intent**: The auth guard is the security-relevant branch and is free to test
(`delete-account.ts:12-15`). The route also depends on two clients, so its
unconfigured branch has two ways in.

**Contract**: Redirect to `/auth/signin` when `locals.user` is null (zero-mock,
and asserted to happen *before* any client is built); `error=Account deletion is
unavailable` when either client is null; error redirect when
`admin.auth.admin.deleteUser` fails; redirect to `/` on success, with
`auth.signOut` called. Requires mocking both `@/lib/supabase` and
`@/lib/supabase-admin`.

### Success Criteria:

#### Automated Verification:

- Test suite passes: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Every route under `src/pages/api/auth/` has a sibling `.test.ts` (8 files)

#### Manual Verification:

- Changing `reset-request.ts` to redirect to an error on provider failure makes
  the suite fail — the email-enumeration guard is genuinely locked
- Failure messages name the route and the branch without needing to open the test

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to Phase 3.

---

## Phase 3: Middleware

### Overview

`src/middleware.ts` is the highest-risk uncovered code in the repo: CSRF origin
checking (`:14-19`), `locals.user` population (`:21-30`), the guest→account merge
choke point (`:37-51`), and the protected-route redirect (`:53-57`). It is out of
reach of Phases 1–2 because it imports `astro:middleware` at runtime
(`middleware.ts:1`) — the one place this change touches the harness. Astro 7 also
changes middleware APIs, so leaving it uncovered would defeat the point of the
sequencing.

### Changes Required:

#### 1. Middleware virtual-module stub

**File**: `vitest.astro-middleware.stub.ts`

**Intent**: Mirror the existing `vitest.astro-env-server.stub.ts` so Vitest can
resolve `astro:middleware`. `defineMiddleware` is an identity function at
runtime — it exists purely for type inference — so the stub returns its argument.

**Contract**: Exports `defineMiddleware`, the module's only export
(`node_modules/astro/dist/virtual-modules/middleware.d.ts:1`). A header comment
matching the existing stub's, stating why the alias exists and that the real
symbol is type-only in effect.

#### 2. Alias registration

**File**: `vitest.config.ts`

**Intent**: Point `astro:middleware` at the stub.

**Contract**: One entry in `resolve.alias` following the existing
`astro:env/server` line (`vitest.config.ts:14`). The block comment above it
generalizes from "Astro's build-time virtual module" to cover both.

#### 3. Middleware tests

**File**: `src/middleware.test.ts`

**Intent**: Cover the four behaviors, with the CSRF guard and the merge fail-open
as the priorities — the first is a security boundary, the second is designed to
swallow errors and so fails silently by construction.

**Contract**: Invoke `onRequest(context, next)` with a `next` spy.

- **CSRF** — 403 for a state-changing method whose `Origin` mismatches
  `url.origin`; passes through when `Origin` matches; passes through when
  `Origin` is absent (the documented non-browser-client case, `:12-13`); passes
  through for `GET` regardless of origin.
- **`locals.user`** — set to `null` when unconfigured; set to the returned user
  when `auth.getUser()` resolves one.
- **Merge** — with `@/lib/guest-progress` and `@/lib/progress` mocked, a guest
  cookie on an authed request triggers `mergeGuestScoresIntoAccount` and deletes
  the cookie; **when the merge rejects, `next()` is still called and the cookie
  is retained** (the fail-open contract at `:44-49`). Stub `console.error` for
  that case so the expected log doesn't pollute the run.
- **Protected routes** — `/dashboard` redirects to `/auth/signin` when
  `locals.user` is null; passes through when set.

The context helper needs `pathname` reachable and `next` injectable; extend
`makeContext` if Phase 1's shape doesn't already cover it.

### Success Criteria:

#### Automated Verification:

- Test suite passes: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Production build still succeeds — the new alias must not affect it:
  `npm run build`
- Full CI-equivalent gate passes: `npm run lint && npm run typecheck && npm test && npm run build`

#### Manual Verification:

- Removing the `try`/`catch` around the merge (`:40-49`) makes the fail-open test
  fail — the swallow-and-continue contract is genuinely asserted, not just
  described
- Inverting the CSRF comparison (`:16`) makes the suite fail
- The stub does not leak into `npm run dev` — start the dev server and confirm
  middleware still runs (auth state resolves, `/dashboard` still redirects when
  signed out)

**Implementation Note**: This is the final phase. After it passes, the change is
ready to close and health-check Fix #1 (Astro 6 → 7) is unblocked.

---

## Testing Strategy

This change *is* the testing work; the strategy is the coverage line itself.

### What these tests assert

**Wiring and status codes, not domain logic.** Routes are thin — validate (zod) →
build client → authorize → delegate to `@/lib/*` → shape a response. The domain
logic lives in `src/lib/` and is already covered by pure-function tests. A route
test that recomputes XP is testing the wrong layer.

### Priority cases

These are the assertions that earn the change its keep — if any of them is
dropped for time, say so explicitly:

1. `reset-request` lands on `?sent=1` even when the provider throws — the
   email-enumeration guard
2. Middleware rejects cross-origin state-changing requests — CSRF
3. Middleware's merge failure is fail-open — `next()` still runs
4. `delete-account` redirects an unauthenticated caller before touching a client
5. `oauth` fails closed when the origin cannot be resolved
6. `quiz`/`lesson` return 403 for a locked zone in both the guest and authed arms

### Conventions this change introduces

`vi.mock` is new to this repo — both existing test files mock nothing. Two rules
that keep it from spreading badly:

- Mock at the `@/lib/*` module boundary, never deeper. If a test needs to reach
  into a mock's internals, the route is doing too much and the test is the wrong
  tool.
- Every mock member is `vi.fn()`, always (see "Critical Implementation Details").

### Manual testing steps

1. `npm test` — count risen from 37; 12 new files listed
2. Break one route deliberately (change a status code); confirm the failure names
   the route
3. Revert; confirm green
4. `npm run build` after Phase 3 — the new alias must not reach production
5. `npm run dev` after Phase 3 — middleware still runs in the real app

## Performance Considerations

Negligible. These are in-process function calls with no I/O, no DB, and no Astro
runtime. Twelve files of a handful of cases each will not move the suite's
runtime meaningfully.

One thing to watch: `vitest.config.ts:18` sets `environment: "jsdom"` globally,
which is unnecessary overhead for route tests and is what makes `crypto.subtle`
unreliable. Leave it alone in this change — a per-file `// @vitest-environment node`
docblock is the escape hatch if a future test needs real Web Crypto.

## Migration Notes

Not applicable — no data, no schema, no production behavior changes. The only
production-adjacent change is one ESLint rule that currently passes on all 11
routes.

## References

- Research: `context/changes/api-route-smoke-tests/research.md` — the two
  executable probes, the cost-tier table, and the context-surface audit
- Upstream driver: `context/foundation/health-check.md` Fix #2 (and Fix #1's
  sequencing note at `:190`)
- House style: `src/lib/progress.test.ts:15-41`
- Prior convention this extends: `context/archive/2026-07-31-xp-across-sessions/plan.md:35-36`
- Existing stub pattern to mirror: `vitest.astro-env-server.stub.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation + Game Routes

#### Automated

- [x] 1.1 Test suite passes: `npm test` — 9ddefa7
- [x] 1.2 Linting passes, including the new rule: `npm run lint` — 9ddefa7
- [x] 1.3 Type checking passes: `npm run typecheck` — 9ddefa7
- [x] 1.4 The new rule actually fires (add value-position `astro` import, confirm error, revert) — 9ddefa7
- [x] 1.5 `src/test/api-context.ts` is not collected as a test file — 9ddefa7

#### Manual

- [ ] 1.6 Breaking a route on purpose fails the suite with a message naming the route and branch
- [ ] 1.7 Helper ergonomics hold up — a new case needs no cast and no boilerplate

### Phase 2: Auth Routes

#### Automated

- [x] 2.1 Test suite passes: `npm test`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Type checking passes: `npm run typecheck`
- [x] 2.4 Every route under `src/pages/api/auth/` has a sibling `.test.ts` (8 files)

#### Manual

- [ ] 2.5 Breaking `reset-request`'s neutral redirect fails the suite
- [ ] 2.6 Failure messages name the route and branch without opening the test

### Phase 3: Middleware

#### Automated

- [ ] 3.1 Test suite passes: `npm test`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Type checking passes: `npm run typecheck`
- [ ] 3.4 Production build still succeeds: `npm run build`
- [ ] 3.5 Full CI-equivalent gate passes: `npm run lint && npm run typecheck && npm test && npm run build`

#### Manual

- [ ] 3.6 Removing the merge `try`/`catch` fails the fail-open test
- [ ] 3.7 Inverting the CSRF comparison fails the suite
- [ ] 3.8 The stub does not leak into `npm run dev` — middleware still runs in the real app
