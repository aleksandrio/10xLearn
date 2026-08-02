# API Route Smoke Tests — Plan Brief

> Full plan: `context/changes/api-route-smoke-tests/plan.md`
> Research: `context/changes/api-route-smoke-tests/research.md`

## What & Why

Add smoke-level Vitest coverage to the 11 API routes under `src/pages/api/` and to
`src/middleware.ts`. The bar is deliberately modest — **the suite fails when a route
stops responding correctly** — but nothing meets it today. This is health-check
Fix #2, and it is the stated prerequisite for the Astro 6 → 7 upgrade (Fix #1),
which touches SSR and the Cloudflare adapter and lands squarely on this uncovered
surface.

## Starting Point

37 tests in two files, both under `src/lib/`, both covering pure functions with
zero mocking. The routes where persistence, auth, CSRF, and XP accrual actually
happen have none. Research settled the blocking unknown with two executable probes:
routes can be imported and invoked directly under the existing Vitest config,
because every route imports `astro` type-only — **no harness change needed**. CI
already runs `npm test`, so new tests gate PRs the moment they land.

## Desired End State

Every route under `src/pages/api/` and `src/middleware.ts` has at least one test
asserting its status code and response shape. Twelve new test files, one shared
context helper, one ESLint guard, one virtual-module stub. Breaking a route — by
upgrading Astro or otherwise — fails CI instead of reaching production.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test harness | No change (one alias added in Phase 3) | Routes import `astro` type-only, so direct invocation works today — proven by probe, not inferred. | Research |
| Coverage depth | Tiers A + B + C | Every route gets a real failing signal and no test needs more than ~3 mocks. | Plan |
| `grade.ts` happy path | Out of scope | ~11 collaborators means the test asserts the mock graph; the XP arithmetic is already covered by `progress.test.ts`. | Research → Plan |
| `src/middleware.ts` | In scope | Highest-risk uncovered code (CSRF, guest→account merge), and Astro 7 changes middleware APIs — skipping it defeats the sequencing. | Plan |
| File layout | One `.test.ts` per route | Matches existing co-location, and `vi.mock` hoists per-file so each route's mocks stay isolated. | Plan |
| Type-only `astro` invariant | ESLint rule | Fails at the import site with an explanation, in CI's existing lint step, instead of surfacing later as an opaque harness break. | Plan |
| Redirect assertions | Assert `Location`, not status | Otherwise the hand-rolled fake's 302 default becomes load-bearing. | Research |

## Scope

**In scope:**

- Shared fake `APIContext` helper (`src/test/api-context.ts`) owning the two unavoidable casts
- 11 route test files + `src/middleware.test.ts`
- `astro:middleware` stub + one `vitest.config.ts` alias
- One scoped ESLint rule guarding the type-only-`astro` invariant

**Out of scope:**

- `grade.ts`'s happy path (~11 mocks)
- E2E / browser tests — those route through `/10x-e2e` per `CLAUDE.md`
- Auth component tests and `src/db/` coverage
- Any production behavior change
- The Astro 7 upgrade itself

## Architecture / Approach

Import each route's exported verb and call it with a hand-built context. One helper
builds that context — a `Map`-backed cookie fake, a `redirect` that returns a
`Response` with a `Location` header, and a real `Request` so `.formData()` /
`.json()` are genuine. Because the env stub sets every value to `""`,
`createClient()` returns `null` by default, making every route's degraded branch
free to test. Reaching happy paths means `vi.mock` at the `@/lib/*` boundary — a
new pattern for this repo, introduced deliberately on the cleanest target first.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation + game routes | Context helper, ESLint guard, `quiz`/`lesson`/`grade` tests | Helper shape is wrong and Phase 2 inherits the friction eight times over |
| 2. Auth routes | 8 test files, Tier A + C | Repetitive enough to invite copy-paste past the real per-route differences |
| 3. Middleware | `astro:middleware` stub + alias, CSRF / merge / guard tests | The new alias must not leak into `npm run build` or `npm run dev` |

**Prerequisites:** None — the harness question is already answered and no
production code changes are required.
**Estimated effort:** ~1–2 sessions across 3 phases; Phase 1 is the thinking,
Phase 2 is the volume.

## Open Risks & Assumptions

- **`strictTypeChecked` on test files is the real friction.** `tsconfig.json`
  includes `**/*` and ESLint has no test-file exemption, so mock objects must clear
  `no-unsafe-assignment` / `no-unsafe-member-access`. If this bites harder than
  expected, a narrow `**/*.test.ts` ESLint override is the escape hatch — but it
  should be a deliberate decision, not a quiet one.
- **Mock factories must use `vi.fn()`**, or per-test overrides fail with
  `mockResolvedValueOnce is not a function`. Research hit this exact wall.
- **`crypto.subtle` is unreliable under jsdom**, so no test may exercise real
  `readGuestScores`. No in-scope test does — but it's one step away.
- **Assumption: routes stay thin.** These tests assert wiring and status codes, not
  domain logic. If business logic migrates into a route, this coverage stops being
  sufficient without anyone noticing.

## Success Criteria (Summary)

- Deliberately breaking any route's status code or redirect target fails `npm test`
- The full CI gate passes end to end: `npm run lint && npm run typecheck && npm test && npm run build`
- Health-check Fix #1 (Astro 6 → 7) can be started with coverage on the code it
  touches
