---
date: 2026-08-02T00:25:59Z
researcher: Aleksander Kowal
git_commit: 1706f19191701c1c5d66166ba0cc33a21e6d7be0
branch: xp-across-sessions
repository: 10xLearn
topic: "How to smoke-test the 11 API routes under the existing Vitest harness"
tags: [research, codebase, api-routes, vitest, testing, astro, supabase]
status: complete
last_updated: 2026-08-02
last_updated_by: Aleksander Kowal
---

# Research: How to smoke-test the 11 API routes under the existing Vitest harness

**Date**: 2026-08-02T00:25:59Z
**Researcher**: Aleksander Kowal
**Git Commit**: `1706f19`
**Branch**: `xp-across-sessions`
**Repository**: 10xLearn

## Research Question

`context/foundation/health-check.md` Fix #2: all 37 tests live in two files under `src/lib/`, leaving the 11 routes under `src/pages/api/` uncovered. Before planning that coverage, one question had to be settled — **how do you invoke an Astro API route under a Vitest config that deliberately avoids Astro's Vite pipeline?**

The concern was that `vitest.config.ts:8-11` refuses `getViteConfig()` because the Cloudflare adapter's plugins break Vitest's runner worker. If route handlers needed the Astro runtime, the whole change would require reworking the harness first.

> **Method note**: `/10x-research` prescribes parallel sub-agents. This session carries an explicit rule against spawning agents unless requested, and the surface here is small (11 route files, ~11 lib modules), so the research was done inline. Findings are backed by two executable probes rather than by reading alone; both were run against `1706f19` and deleted afterward.

## Summary

**No harness changes are needed.** Route handlers can be imported and invoked directly today. This was verified by running throwaway tests, not inferred:

- **Probe 1** (4 tests, passed): imported `grade.ts`, `quiz.ts`, and `signin.ts`, invoked them with a hand-built context object, and asserted 400 / 503 / 302 responses.
- **Probe 2** (2 tests, passed): mocked `@/lib/supabase`, `@/lib/content`, `@/lib/progress` and drove `quiz.ts` through its 200 happy path and its 403 locked-zone path.

The reason it works is a single structural fact: **every route imports `astro` type-only**, so nothing pulls the Astro runtime into the module graph. The only runtime virtual module anywhere in the reachable graph is `astro:env/server`, and `vitest.config.ts` already aliases it to a stub.

Two consequences shape the plan:

1. The stub sets `SUPABASE_URL`/`SUPABASE_KEY` to `""`, so `createClient()` returns `null` **by default**. Every route's "unconfigured" branch is therefore reachable with **zero mocking** — a whole tier of real assertions for almost no cost.
2. Reaching happy paths means mocking `@/lib/*` collaborators. Cost varies sharply by route: `quiz.ts` needs 3 mocks, `grade.ts` needs ~11.

## Detailed Findings

### Route inventory and context surface

11 routes, one exported verb each (`src/pages/api/**`):

| Route | Verb | Returns | `locals.user` |
|---|---|---|---|
| `auth/signin.ts` | POST | `redirect` | — |
| `auth/signup.ts` | POST | `redirect` | — |
| `auth/signout.ts` | POST | `redirect` | — |
| `auth/callback.ts` | GET | `redirect` | — |
| `auth/oauth.ts` | POST | `redirect` | — |
| `auth/reset-request.ts` | POST | `redirect` | — |
| `auth/update-password.ts` | POST | `redirect` | — |
| `auth/delete-account.ts` | POST | `redirect` | ✓ |
| `game/quiz.ts` | GET | `Response.json` | ✓ |
| `game/lesson.ts` | GET | `Response.json` | ✓ |
| `game/grade.ts` | POST | `Response.json` | ✓ |

The `APIContext` surface they actually touch is small and uniform — **one `makeContext()` helper serves all 11**:

- `context.request` — `.headers` (all 11), `.formData()` (4 auth routes), `.json()` (`grade`)
- `context.cookies` — `.get()`, plus `.set()`/`.delete()` reached indirectly through `createClient` and `writeGuestScores`
- `context.url` — `.searchParams` (`callback`, `quiz`, `lesson`), `.origin` (`oauth`, `reset-request`)
- `context.locals.user` — 4 routes
- `context.redirect()` — the 8 auth routes

A minimal fake for `cookies` (`get`/`set`/`delete`/`has` over a `Map`) and `redirect` (`(loc, status=302) => new Response(null, {status, headers:{Location: loc}})`) is sufficient. No Astro import required.

### Why direct invocation works

All 11 routes open with `import type { APIRoute } from "astro"` — **type-only, erased at compile**. Verified exhaustively; there is no value-position `astro` import in any route.

Tracing the runtime graph, the only `astro:*` virtual modules are in `src/lib/`:

- `src/lib/supabase.ts:3` — `astro:env/server`
- `src/lib/supabase-admin.ts:2` — `astro:env/server`
- `src/lib/guest-progress.ts:24` — `astro:env/server`
- `src/lib/site-url.ts:1` — `astro:env/server`
- `src/lib/config-status.ts:1` — `astro:env/server`

All five resolve to the same specifier, already aliased at `vitest.config.ts:16-18` to `vitest.astro-env-server.stub.ts`. The stub exports all five names the app consumes, so the alias is complete — no missing-export failures.

### The stub makes "unconfigured" the default state

`vitest.astro-env-server.stub.ts:6-10` sets every value to `""`. `createClient` short-circuits on falsy config (`src/lib/supabase.ts:7-9`), as does `createAdminClient` (`src/lib/supabase-admin.ts:11-13`).

So an unmocked route test exercises the degraded path. That is not a limitation — it is free coverage of behavior that genuinely matters, and it is currently untested:

- `game/*` → `503` with a user-facing message (`quiz.ts:24`, `grade.ts:70`)
- `auth/*` → `redirect` carrying an error query param (`signin.ts:13`)

The stub's own comment endorses the mock seam for anything else: *"a unit test that needs real config should mock the consuming module instead of relying on these."*

### Mock seam and one sharp edge

`vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))` is enough to get past the null guard — the returned object only needs the methods the route under test actually calls.

**Sharp edge, found by the probe failing:** mock factory functions must be declared with `vi.fn()`, not plain functions, or per-test overrides fail with `vi.mocked(...).mockResolvedValueOnce is not a function`. Probe 2's first run hit exactly this. Declare factories as `vi.fn(async () => ...)` from the start.

### Cost tiers (the main planning input)

| Tier | Routes / cases | Mocks needed |
|---|---|---|
| **A — zero mocks** | Body/param validation: `grade` 400 (non-JSON), `grade` 400 (schema), `quiz`/`lesson` 400 (missing `zoneSlug`). Auth guard: `delete-account` → redirect when `locals.user` is null (`delete-account.ts:12-15`). Unconfigured branches for all 11. | none |
| **B — light (2–3)** | `quiz`, `lesson`: 200 happy path, 403 locked, 404 not-found | `@/lib/supabase`, `@/lib/content`, `@/lib/progress` |
| **C — medium** | 7 auth routes: success + error branches | `@/lib/supabase` returning an `auth` fake (`signInWithPassword`, `signUp`, `signOut`, …); `@/lib/site-url` for `oauth`/`reset-request` |
| **D — heavy** | `grade.ts` happy path | ~11 collaborators across `content`, `game`, `guest-progress`, `progress` (`grade.ts:3-23`), plus separate authed vs guest branches |

Tier A alone would take the API routes from zero signal to failing-on-regression, which is what the health check asked for. Tier D is where mock-heavy tests start asserting the mocks rather than the code — `grade.ts`'s real risk (retake XP arithmetic, unlock derivation) is better served by the pure-function tests that already exist in `src/lib/progress.test.ts` plus eventual E2E.

### House style to match

From `src/lib/progress.test.ts`:

- Plain `describe` / `it` / `expect` from `vitest`; no globals reliance despite `globals: true`
- A header comment stating **what the file locks down and why** (`progress.test.ts:15-16`)
- Small typed factory helpers over inline literals (`zone()`, `attempt()` — `progress.test.ts:18-25`)
- Comments explaining *why* fixture values were chosen (`progress.test.ts:36-37`)

Note that **both existing test files cover pure functions and use no mocking at all**. Route tests introduce `vi.mock` as a new pattern in this repo — worth calling out in the plan rather than letting it arrive unannounced.

## Code References

- `vitest.config.ts:8-11` — rationale for avoiding `getViteConfig()` (Cloudflare adapter breaks the runner worker)
- `vitest.config.ts:16-18` — `astro:env/server` → stub alias
- `vitest.config.ts:22` — `include: ["src/**/*.{test,spec}.{ts,tsx}"]`, so route tests co-locate under `src/pages/api/`
- `vitest.astro-env-server.stub.ts:6-10` — all five env exports, all `""`
- `src/lib/supabase.ts:6-25` — `createClient(headers, cookies)`, returns `null` when unconfigured
- `src/lib/supabase-admin.ts:10-17` — service-role client, same null-guard shape
- `src/pages/api/game/quiz.ts:15-47` — cleanest Tier B target: validate → client → gate → fetch → respond
- `src/pages/api/game/grade.ts:54-168` — Tier D; the 11-collaborator route
- `src/pages/api/auth/delete-account.ts:12-15` — zero-mock auth-guard test
- `src/pages/api/auth/signin.ts:6-22` — canonical Tier C shape
- `src/middleware.ts:9-60` — CSRF, `locals.user`, guest→account merge (see Open Questions)
- `src/lib/progress.test.ts:15-41` — house style reference

## Architecture Insights

- **Routes are thin and uniform.** Validate (zod) → build client → authorize → delegate to `@/lib/*` → shape a response. Business logic lives in `src/lib/`, which is why pure-function tests were the right first investment and why route tests should assert *wiring and status codes*, not recompute domain logic.
- **The null-client pattern is load-bearing.** Both client factories return `null` rather than throwing, and every consumer branches on it. That is what makes the degraded state testable for free — and it is the same design that made the health check's "require the env vars" proposal wrong.
- **Guests and authed users share one code path**, split on `locals.user` at `grade.ts:73` and `quiz.ts:29`. Any route test matrix should cover both arms; a fake context makes that a one-line change.
- **Type-only Astro coupling is what buys testability.** It is an implicit invariant nobody wrote down: the day a route does `import { something } from "astro"` in value position, direct invocation breaks. Worth an assertion or a lint rule.

## Historical Context (from prior changes)

- `context/archive/2026-07-31-xp-across-sessions/plan.md:35-36` — establishes the current convention: *"Pure-logic tests co-locate at `src/lib/progress.test.ts` (Vitest, `@/*` alias, no DB — pure functions)."* Route tests are a deliberate extension of that convention, not a contradiction of it, but the plan should say so explicitly.
- `context/archive/2026-07-28-guest-core-loop/plan.md:13` — records the stack and the Cloudflare adapter choice that the Vitest config later had to work around.
- No prior change attempted API-route or middleware tests; there is no abandoned approach to avoid re-litigating.

## Related Research

None — this is the first research artifact for this change. Upstream driver is `context/foundation/health-check.md` (2026-08-02), outstanding Fix #2.

## Open Questions

1. **`src/middleware.ts` has no coverage and is not reachable by this approach.** It imports `astro:middleware` at runtime (`middleware.ts:1`), which is not aliased. It holds real logic: CSRF origin checking (`:14-19`), `locals.user` population (`:21-30`), and the guest→account merge choke point (`:37-51`). Cheap fix if wanted — alias `astro:middleware` to a stub exporting `defineMiddleware = (fn) => fn`, mirroring what already exists for `astro:env/server`. **Decide in planning whether middleware is in scope**; it is arguably higher-risk than several of the routes.
2. **How faithful must the `redirect` fake be?** Astro's real `context.redirect` defaults to 302 and validates the status. A hand-rolled fake is fine for smoke assertions, but if tests start asserting exact status codes, the fake's defaults become load-bearing. Recommend asserting on `Location` primarily.
3. **Does Tier D earn its keep?** Recommendation: no, not in this change. Cap at Tier A + B + C and let `grade.ts`'s happy path be covered by E2E via `/10x-e2e`, where the retake/XP arithmetic can be exercised end-to-end against real data instead of eleven mocks.
4. **Should the type-only-`astro`-import invariant be enforced?** A lint rule (`no-restricted-imports` allowing only `import type` from `astro` under `src/pages/api/`) would keep this change's premise from silently rotting.
