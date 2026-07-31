# Guest Core Loop (S-01) — Plan Brief

> Full plan: `context/changes/guest-core-loop/plan.md`

## What & Why

Build the north-star slice: a guest (no account) lands on a checkpoint **world map**, opens Zone 1's lesson and quiz checkpoints, passes the 3-question quiz, and watches **Zone 2 unlock** — all in one session, no login. This is the validation milestone: the PRD treats the loop as atomic — "if this loop works, the product works." Everything downstream (persistence, XP, accessibility hardening) only matters if this pull-to-continue is real.

## Starting Point

F-01 is done: a read-only, typed content layer (`src/lib/content.ts`) with 2 seeded zones (1 lesson + 3 quiz questions each), and answer-key isolation already enforced by a public view + a server-side grading RPC. The stack is Astro 6 SSR + React 19 islands + Tailwind 4 + shadcn/ui on Cloudflare. Auth is scaffolded but unused here. `/` still renders the starter welcome; there are no progression tables and no test framework.

## Desired End State

`/` is a checkpoint world map. A guest reads Zone 1's lesson, passes its quiz, and Zone 2 unlocks visibly (and survives a refresh, via a signed cookie). Failing lets them retry immediately, unlimited times, with Zone 2 locked. Locked zones' content endpoints refuse direct calls (403), so access stays earned. The whole loop is keyboard-operable and screen-reader-labelled at a baseline level.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Guest unlock state | Signed HTTP cookie (HMAC via Web Crypto) | Server-readable so the map renders correct on first paint, and it's the natural S-02 handoff. | Plan |
| Quiz submit/grade | React island → JSON `/api/game/grade` | Meets the <800 ms "feels immediate" NFR and keeps the answer key server-side. | Plan |
| Unlock reveal | Inline success panel → CTA back to map | Clear cause→effect and a deliberate "return and see it open" beat — the pull-to-continue. | Plan |
| Entry point | Map replaces `/` (retire starter welcome) | Matches "a guest lands on the world map" — zero-friction entry. | Plan |
| Navigation model | One island-orchestrated page; **no per-zone URLs** | User steer: map/lesson/quiz driven by state + endpoints, not URL routing. | Plan (user) |
| Map structure | Checkpoint map — separate **lesson** and **quiz** checkpoints per zone | User steer: distinct checkpoint types (gather info vs. take quiz to unlock). | Plan (user) |
| Access gate | Content endpoints re-verify the cookie and 403 on locked zones | With no zone URLs, the gate moves to the endpoints — earned access holds against direct calls. | Plan |
| Accessibility | Accessible baseline built in now | Cheap when built-in; makes S-04 a verification pass, not a retrofit. | Plan |

## Scope

**In scope:** `/` world-map page (island) with lesson/quiz checkpoints; `/api/game/{lesson,quiz,grade}` endpoints (zod-validated, unlock-gated); signed guest-progress cookie helper (Web Crypto); pass/fail + unlimited retry + unlock transition; accessible baseline; new optional `GUEST_PROGRESS_SECRET` env var.

**Out of scope:** accounts/sign-up/DB persistence (S-02), XP (S-03), a11y audit (S-04), new tables/migrations/seed changes, anti-cheat hardening, per-zone URL routes, Playwright/E2E, mobile layout.

## Architecture / Approach

One page (`/`) hosts a `WorldMap` island (`client:load`). The page frontmatter reads+verifies the signed cookie, builds the map model from `getZones()` + `getMissionByZone()` (each zone → lesson + quiz checkpoint + `locked` flag), and passes it as `initialState` (no hydration flash). The island swaps between `map` / `lesson` / `quiz` sub-views without touching the URL, fetching gated content from `/api/game/lesson` and `/api/game/quiz`. Submitting POSTs to `/api/game/grade`, which grades via the existing `gradeQuiz()` RPC and, on a pass, derives the next zone from `order_index`, re-signs the cookie, and returns the new unlocked set for the map to re-render.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Map renders | Signed-cookie read helper + `/` map island showing locked/unlocked checkpoints | Cookie verify must fail-safe to fresh (no 500) and render without flash |
| 2. Open checkpoint | Gated lesson/quiz GET endpoints + lesson/quiz island sub-views | 403 gating must hold against direct calls; no answer key in the quiz payload |
| 3. Pass & unlock | Grade endpoint (re-signs cookie on pass) + result/retry + unlock reveal | Unlock derived server-side from zone order, never client-supplied; unlimited retry |

**Prerequisites:** F-01 done (it is); Docker + `npx supabase start` + `npm run db:reset` for a seeded local DB; `npm run dev`.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- **Web Crypto, not `node:crypto`** — Cloudflare workerd requires `crypto.subtle` for HMAC; getting this wrong breaks the deploy build.
- **Guest cookie is single-session integrity, not real security** — it enforces the earned-access rule cheaply; account-backed persistence and the guest→account handoff are S-02.
- **No automated loop test** — verification is manual + lint/build here; full Playwright E2E is S-04 / the `/10x-e2e` skill.
- **Answer-key isolation is inherited from F-01** — the plan must only grade via `gradeQuiz()` and read options via the public view; never touch `correct_option_id`.

## Success Criteria (Summary)

- A guest completes map → lesson → quiz → pass → **Zone 2 unlocks**, and the unlock survives a refresh.
- A fail keeps Zone 2 locked and allows immediate unlimited retry; a locked zone's endpoints return 403.
- The full loop is completable keyboard-only, with pass/fail and unlock announced to a screen reader.
