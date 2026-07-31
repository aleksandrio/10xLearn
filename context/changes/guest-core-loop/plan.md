# Guest Core Loop (S-01) Implementation Plan

## Overview

Build the north-star slice: a guest (no account) lands on a checkpoint **world map** at `/`, opens Zone 1's **lesson checkpoint** to read, opens its **quiz checkpoint**, passes the 3-question quiz, and watches **Zone 2 unlock** — all in one session, no login. This proves the core product hypothesis (the "pull to continue"); if this loop works, the product works (PRD §Success Criteria).

The loop is one island-orchestrated page (`/`) that swaps between **map → lesson → quiz** sub-views driven by internal state and `/api/game/*` endpoints — **not** by URL routing. Guest unlock state lives in a **signed HTTP cookie**: the page reads it server-side to render the map correctly on first paint; the grade endpoint re-signs it on a pass. Content endpoints enforce the earned-access rule (a locked zone's lesson/quiz is never served).

## Current State Analysis

- **Content layer is complete and typed (F-01).** `src/lib/content.ts` exposes `getZones()`, `getMissionByZone(slug)`, `getQuizQuestions(missionId)`, and `gradeQuiz(missionId, answers)`. The answer key is isolated behind the `quiz_questions_public` view and the `grade_mission_quiz` RPC (`supabase/migrations/20260727205534_content_model.sql`) — grading is server-side and the correct answer never reaches the client.
- **Seed data (F-01):** 2 ordered zones (`foundations` order 1, `context-and-agents` order 2), each with 1 mission → 1 lesson + 3 quiz questions (`supabase/seed.sql`). This is exactly enough to demonstrate one unlock transition.
- **Stack:** Astro 6 SSR (`output: "server"`, `astro.config.mjs:11`) + React 19 islands + Tailwind 4 + shadcn/ui "new-york" (`src/components/ui/`), Cloudflare adapter. Path alias `@/* → ./src/*`.
- **Middleware** populates `Astro.locals.user` (guest = `null`, `src/middleware.ts`). No route protection is needed for this loop — every surface is public. `PROTECTED_ROUTES` is untouched.
- **Supabase client factory** `createClient(headers, cookies)` returns `null` when env is unset (`src/lib/supabase.ts`). Env is wired via Astro `envField` (`astro.config.mjs:17-22`); vars are optional so the app boots un-configured behind a banner (`src/lib/config-status.ts`, surfaced in `src/layouts/Layout.astro`).
- **Entry point today:** `/` renders the starter `Welcome` component (`src/pages/index.astro`) — this slice retires it.
- **API convention (AGENTS.md):** endpoints `export const prerender = false`, uppercase `GET`/`POST`, validate input with **zod**. Existing endpoints follow the redirect pattern (`src/pages/api/auth/signin.ts`); the game endpoints return **JSON** instead (island fetches them).
- **No progression/persistence tables**, and none are added here — account-backed persistence is S-02. Guest state is cookie-only and in-session.
- **No test framework installed** (no vitest/playwright in `package.json`). Automated verification is `npm run lint` (type-checked ESLint) + `npm run build` (Astro SSR build, which type-checks via `@astrojs/check`). The loop is verified manually in-browser; full Playwright E2E is the `/10x-e2e` skill (S-04 territory), out of scope here.

## Desired End State

Running `npm run dev` against a seeded local Supabase, a guest can:

1. Open `/` and see a world map with **Zone 1's checkpoints open and Zone 2's locked**, rendered correctly on first paint (no flash), reflecting a signed cookie (or a fresh default when absent/tampered).
2. Click Zone 1's **lesson checkpoint** → read the Prompting Basics lesson in a panel.
3. Click Zone 1's **quiz checkpoint** → answer 3 questions → submit.
4. On a **pass** (all 3 correct): see a success panel ("Zone 2 unlocked"), click the CTA back to the map, and see **Zone 2 now unlocked**. The unlock survives a page refresh (cookie).
5. On a **fail**: see which were wrong and **retry immediately, unlimited times**; Zone 2 stays locked.
6. Every locked-zone lesson/quiz endpoint returns **403** to a direct call — access is earned, never granted freely.
7. The whole loop is **keyboard-operable** and screen-reader-labelled at a baseline level.

Verified by: `npm run lint` and `npm run build` pass; manual browser walkthrough of the above.

### Key Discoveries

- Answer-key isolation is already guaranteed by F-01 — the plan must **only** grade via `gradeQuiz()`/the RPC and read quiz options via `getQuizQuestions()` (the public view); never touch `quiz_questions.correct_option_id` (`src/lib/content.ts:87-120`).
- Cloudflare workerd requires **Web Crypto** (`crypto.subtle`) for HMAC — `node:crypto` is not available in the deploy runtime. Signing/verifying the cookie must use `crypto.subtle` (async).
- Zone ordering drives unlocking: passing the quiz of the zone at `order_index = N` unlocks the zone at `order_index = N+1` (`getZones()` returns them ascending).
- Env vars are declared in `astro.config.mjs` `env.schema` and read via `astro:env/server` (see `src/lib/supabase.ts:3`) — the new secret follows this exact pattern, `optional: true` so the app still boots without it.

## What We're NOT Doing

- **No account, sign-up, or DB-backed persistence** — that's S-02 (`persist-progress-with-signup`). Guest state is cookie-only, single-session.
- **No new database tables, migrations, or seed changes** — F-01's content model is consumed as-is.
- **No XP** — that's S-03.
- **No dedicated accessibility audit / screen-reader remediation pass** — this slice builds an accessible *baseline*; the audit is S-04.
- **No anti-cheat / brute-force hardening** — unlimited retry is intentional (PRD §Non-Goals, Open Question 1).
- **No per-zone URL routes** — navigation is endpoint/state-driven from one page.
- **No Playwright/E2E harness** — verification is manual + lint/build here.
- **No mobile-optimized layout** — desktop-first (PRD §Non-Goals).

## Implementation Approach

One Astro page (`/`) hosts a `WorldMap` React island (`client:load`). The page frontmatter reads the signed guest-progress cookie, computes the unlocked-zone set, assembles the initial map model (zones from `getZones()`, each annotated with its mission/lesson/quiz checkpoint metadata and a `locked` flag), and passes it as the island's `initialState` prop — SSR-correct, no hydration flash.

The island holds view state (`map` | `lesson` | `quiz`, plus the active zone) and never changes the URL. Clicking a checkpoint fetches gated content from `/api/game/lesson` or `/api/game/quiz`. Submitting the quiz POSTs to `/api/game/grade`, which grades via `gradeQuiz()`, and **on a pass** re-signs and sets the unlock cookie, returning the new unlocked set; the island updates its state so the map reflects the unlock when the learner returns via the success CTA.

Guest state is a signed cookie holding the set of unlocked zone slugs (HMAC-SHA256 via Web Crypto). A read helper verifies the signature and **defaults to fresh (Zone 1 only) on any missing/invalid/tampered cookie** — fail-safe, never a 500. All endpoints re-verify unlock server-side so the earned-access rule can't be bypassed by direct API calls.

## Critical Implementation Details

- **Web Crypto only.** HMAC signing/verifying the cookie must use `crypto.subtle.sign/verify` (async) — `node:crypto` is unavailable on Cloudflare workerd. Import a `SubtleCrypto`-based helper; keep it isolated in `src/lib/guest-progress.ts`.
- **Cookie is the unlock authority, and every endpoint re-checks it.** The map prop is a convenience for first paint; the lesson/quiz/grade endpoints must independently read+verify the cookie and 403 on a locked zone. Never trust a zone id from the request body as "unlocked."
- **Unlock is derived, not client-supplied.** The grade endpoint computes the next unlocked zone from `order_index` server-side and re-signs the cookie; the client never tells the server which zones to unlock.

---

## Phase 1: World map renders (guest lands)

### Overview

A guest opens `/` and sees the checkpoint world map with Zone 1's checkpoints open and Zone 2's locked, rendered from the signed cookie server-side (fresh default when absent/tampered). No lesson/quiz interaction yet.

### Changes Required

#### 1. Guest-progress cookie helper (read/verify side)

**File**: `src/lib/guest-progress.ts` (new)

**Intent**: Own the signed guest unlock cookie. This phase needs the **read** side: parse the cookie, verify its HMAC signature via Web Crypto, and return the set of unlocked zone slugs — defaulting to the fresh state (the first zone by order only) on a missing, malformed, or tampered cookie. The write/sign side is added in Phase 3.

**Contract**:
- Exports (async, Web Crypto): `readUnlockedZones(cookieValue: string | undefined): Promise<Set<string>>` returning unlocked zone slugs; a fresh guest → the first zone's slug only.
- Cookie name constant (e.g. `GUEST_PROGRESS_COOKIE`) and the payload shape (a signed list of unlocked slugs, e.g. `base64(json).base64(hmac)`).
- Reads `GUEST_PROGRESS_SECRET` from `astro:env/server`; when unset, fall back to a fixed dev-only default constant so local dev works (documented as insecure — real secret set in deploy env).
- Invalid signature / parse error → return fresh default, never throw.

#### 2. Register the signing secret env var

**File**: `astro.config.mjs`, `.env.example`

**Intent**: Declare `GUEST_PROGRESS_SECRET` so the helper can read it via `astro:env/server`, mirroring the existing `SUPABASE_*` declarations.

**Contract**: Add `GUEST_PROGRESS_SECRET: envField.string({ context: "server", access: "secret", optional: true })` to `env.schema`; add the var (with a placeholder) to `.env.example`.

#### 3. Map data assembly + checkpoint model

**File**: `src/lib/game.ts` (new) or extend `src/lib/content.ts`

**Intent**: Build the map model the island renders: every zone (via `getZones()`), annotated with its mission (via `getMissionByZone(slug)`), a lesson checkpoint and a quiz checkpoint, and a `locked` flag derived from the unlocked-slug set. Also expose the "is this zone unlocked" and "next zone to unlock" helpers the endpoints reuse.

**Contract**:
- A `MapZone` type: `{ slug, title, order_index, locked, mission: { id, title }, checkpoints: [{ type: 'lesson', ... }, { type: 'quiz', ... }] }`.
- `buildMapModel(supabase, unlocked: Set<string>): Promise<MapZone[]>` in play order.
- `nextZoneSlug(zones, currentSlug): string | null` (by `order_index`), used by Phase 3.

#### 4. World map page (retire the starter welcome)

**File**: `src/pages/index.astro`

**Intent**: Replace `Welcome` with the map. Frontmatter creates the Supabase client, reads+verifies the unlock cookie, builds the map model, and renders the `WorldMap` island with `initialState`. Handle the un-configured/failed-fetch case with a friendly message (reuse the layout's banner convention) instead of a broken page.

**Contract**: Reads the cookie via `Astro.cookies.get(GUEST_PROGRESS_COOKIE)?.value`; passes `initialZones={mapModel}` to `<WorldMap client:load />`. `Welcome.astro` import removed.

#### 5. WorldMap island (map sub-view only)

**File**: `src/components/game/WorldMap.tsx` (new)

**Intent**: Render the world map from `initialZones`: each zone as a node with its two checkpoints, visually distinguishing locked vs unlocked and lesson vs quiz. This phase renders only the `map` view; checkpoint clicks are wired in Phase 2. Build the accessible baseline now: semantic landmark + heading, checkpoints as real `<button>`s with accessible names conveying zone + type + locked state, locked checkpoints `disabled`/`aria-disabled`, visible focus.

**Contract**: `WorldMap({ initialZones }: { initialZones: MapZone[] })`. Holds view state (`{ view: 'map' | 'lesson' | 'quiz', activeZone: string | null }`) with only `map` reachable this phase. Tailwind classes merged via `cn()` from `@/lib/utils`.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Build + type-check passes: `npm run build`

#### Manual Verification

- `/` shows the world map (no starter welcome); Zone 1 checkpoints appear unlocked, Zone 2 checkpoints appear locked.
- A fresh guest (no cookie) sees exactly Zone 1 unlocked; refresh preserves it.
- A hand-tampered `guest_progress` cookie falls back to the fresh default (Zone 1 only) — no error page.
- With Supabase unconfigured, `/` shows a friendly message, not a crash.
- Map is reachable/operable by keyboard (Tab to each checkpoint, visible focus); locked checkpoints are announced as locked.

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual walkthrough before starting Phase 2.

---

## Phase 2: Open a checkpoint — read the lesson / see the quiz

### Overview

Clicking Zone 1's lesson checkpoint fetches and displays the lesson; clicking its quiz checkpoint fetches and displays the 3 questions (no grading yet). Locked zones' content endpoints refuse to serve (403).

### Changes Required

#### 1. Lesson content endpoint (unlock-gated)

**File**: `src/pages/api/game/lesson.ts` (new)

**Intent**: Return a zone's mission lesson as JSON, only if the zone is unlocked per the cookie; otherwise 403. Enforces earned access even against direct calls.

**Contract**: `GET`, `export const prerender = false`. Query `zoneSlug` validated with zod. Reads+verifies the cookie via `readUnlockedZones`; if `zoneSlug` not unlocked → 403. On success returns `{ mission, lesson }` from `getMissionByZone(zoneSlug)`. 404 when the zone/mission/lesson is absent; 500-safe on client-null (friendly JSON error).

#### 2. Quiz content endpoint (unlock-gated)

**File**: `src/pages/api/game/quiz.ts` (new)

**Intent**: Return a zone's mission quiz questions (no answer key) as JSON, only if unlocked; else 403.

**Contract**: `GET`, `prerender = false`. Query `zoneSlug` zod-validated. Cookie-gated as above. Resolves the mission via `getMissionByZone`, then returns `getQuizQuestions(missionId)` (reads the `quiz_questions_public` view — no `correct_option_id`). 403 on locked, 404 on missing.

#### 3. WorldMap island — lesson & quiz sub-views + fetch wiring

**File**: `src/components/game/WorldMap.tsx`, plus `src/components/game/LessonPanel.tsx` and `src/components/game/QuizPanel.tsx` (new)

**Intent**: Wire checkpoint clicks to fetch content and switch sub-views. Lesson checkpoint → fetch `/api/game/lesson` → render lesson body in `LessonPanel` with a "back to map" control. Quiz checkpoint → fetch `/api/game/quiz` → render questions in `QuizPanel` (display only this phase; submit lands in Phase 3). Loading and error states for each fetch. Keep the accessible baseline: focus moves into the opened panel, headings/landmarks, lesson body rendered readably.

**Contract**: `WorldMap` gains async handlers `openLesson(zoneSlug)` / `openQuiz(zoneSlug)` that fetch, set `activeZone` + fetched payload, and switch `view`. `LessonPanel({ mission, lesson, onBack })`; `QuizPanel({ questions, onBack })` (radio-group per question, no submit yet). Markdown-ish lesson body: render as preformatted/simple markup (no new markdown dep unless one already resolves) — keep it a plain readable render.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Build + type-check passes: `npm run build`
- Locked-zone gate holds: `curl "http://localhost:4321/api/game/lesson?zoneSlug=context-and-agents"` returns HTTP 403 for a fresh guest (no cookie); `zoneSlug=foundations` returns the lesson JSON.

#### Manual Verification

- Clicking Zone 1's lesson checkpoint shows the Prompting Basics lesson; "back" returns to the map.
- Clicking Zone 1's quiz checkpoint shows 3 questions with selectable options and no correct-answer hint in the payload (verify in Network tab).
- Zone 2's checkpoints cannot be opened (locked); a direct `/api/game/quiz?zoneSlug=context-and-agents` call returns 403.
- Lesson/quiz panels are keyboard-navigable; focus lands in the panel on open.

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual walkthrough before starting Phase 3.

---

## Phase 3: Take the quiz → pass/fail → unlock

### Overview

The learner submits the quiz; the grade endpoint scores it server-side, and on a pass re-signs the unlock cookie and returns the new unlocked set. A success panel announces the unlock and the CTA returns to the map with Zone 2 now open. On a fail, the learner sees which answers were wrong and retries immediately, unlimited times. This closes the north-star loop.

### Changes Required

#### 1. Guest-progress cookie helper (write/sign side)

**File**: `src/lib/guest-progress.ts`

**Intent**: Add the sign+serialize side used by the grade endpoint to persist a new unlock.

**Contract**: `writeUnlockedZones(cookies: AstroCookies, unlocked: Set<string>): Promise<void>` — serializes + HMAC-signs (Web Crypto) and sets the cookie (`httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure` in prod, a session-appropriate max-age). Same secret/format the read side verifies.

#### 2. Grade endpoint (gated, grades, unlocks)

**File**: `src/pages/api/game/grade.ts` (new)

**Intent**: Grade a submission for a zone's mission and, on a pass, unlock the next zone. Answer key never leaves the DB — grading goes through `gradeQuiz()`/the RPC. Unlock is derived server-side from zone order, never taken from the request.

**Contract**: `POST`, `prerender = false`. Body `{ zoneSlug: string, answers: { question_id: string, option_id: string }[] }` zod-validated (non-empty answers). Cookie-gated: 403 if `zoneSlug` not unlocked. Resolves mission via `getMissionByZone`, calls `gradeQuiz(missionId, answers)`. On `passed`: compute `nextZoneSlug`, add to the unlocked set, `writeUnlockedZones(...)`. Returns `{ passed, correct_count, total, results, unlockedZones: string[] }`. On fail: returns the result, cookie unchanged.

#### 3. QuizPanel — submit, result, retry

**File**: `src/components/game/QuizPanel.tsx`, `src/components/game/WorldMap.tsx`

**Intent**: Add submit → grade → result. Block submit until all 3 answered (client), and rely on zod server-side too. Show per-question correctness on the result; on fail, offer "Try again" (reset answers, unlimited) with Zone 2 still locked; on pass, show the success panel ("You passed! Zone 2 unlocked") with a CTA back to the map. The CTA updates the island's zone state from `unlockedZones` so the map re-renders Zone 2 as open. Announce pass/fail and the unlock via `aria-live`.

**Contract**: `QuizPanel` gains `onGraded(result)`; `WorldMap` handles the grade response, updates `initialZones`-derived state with `unlockedZones`, and routes to the success panel or inline retry. Submit disabled until complete; POSTs to `/api/game/grade`.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Build + type-check passes: `npm run build`
- Grade gate + integrity: a `POST /api/game/grade` for `zoneSlug=context-and-agents` from a fresh guest returns 403; a correct `foundations` submission returns `{ passed: true, ... }` and a `Set-Cookie` for the guest-progress cookie.
- Empty/partial answers → `POST /api/game/grade` returns 400 (zod rejection).

#### Manual Verification

- Passing Zone 1's quiz (all 3 correct) shows the success panel; the CTA returns to the map with **Zone 2 unlocked**; a page refresh keeps Zone 2 unlocked.
- Failing (≤2 correct) shows which were wrong and a "Try again" that lets the learner retry immediately, unlimited times; Zone 2 stays locked.
- After unlocking, Zone 2's lesson and quiz checkpoints open and its endpoints return 200 (no longer 403).
- The full loop (map → lesson → quiz → pass → unlock) is completable keyboard-only; pass/fail and unlock are announced to a screen reader (`aria-live`).

**Implementation Note**: After automated verification passes, pause for human confirmation that the full loop works before considering the slice done.

---

## Testing Strategy

No unit/E2E framework is installed in this slice (see Current State). Verification is:

### Automated (per phase)
- `npm run lint` (type-checked ESLint, includes `jsx-a11y`) and `npm run build` (SSR build + `@astrojs/check` type-check).
- Endpoint contract checks via `curl` against a running `npm run dev` + seeded local Supabase (403 gating, JSON shape, `Set-Cookie`, 400 on bad input) — listed in each phase's Automated Verification.

### Manual Testing Steps
1. `npx supabase start` + `npm run db:reset` (seeds 2 zones), then `npm run dev`.
2. Open `/` → confirm Zone 1 open, Zone 2 locked.
3. Open Zone 1 lesson → read → back to map.
4. Open Zone 1 quiz → answer wrong on purpose → confirm fail + retry, Zone 2 still locked.
5. Answer all 3 correctly → confirm success panel → CTA → Zone 2 unlocked.
6. Refresh → Zone 2 still unlocked. Tamper the cookie → back to Zone 1 only.
7. Repeat the happy path keyboard-only; sanity-check screen-reader announcements.

### Edge cases to test explicitly
- Missing/tampered cookie → fresh default (no crash).
- Direct API call to a locked zone → 403.
- Empty/partial quiz submission → blocked client-side + 400 server-side.
- Supabase unconfigured → friendly message.

## Performance Considerations

At `<1 qps` performance is trivial, but the NFR is *perceived* immediacy (<~800 ms p95 for quiz submit / unlock / map nav). The island fetches small JSON payloads and grades server-side in one RPC; sub-view switches are client-state changes (instant). No extra round-trips beyond one fetch per checkpoint open and one per grade.

## Migration Notes

No database changes. One new env var `GUEST_PROGRESS_SECRET` (optional; dev falls back to an insecure default, real value set in the Cloudflare/deploy environment). The starter `Welcome` component is retired from `/` (component file may remain unused).

## References

- Roadmap slice S-01: `context/foundation/roadmap.md` (lines 78-89)
- PRD: `context/foundation/prd.md` (US-01, FR-001/004/005/006/007/008/009, §Business Logic, §NFR)
- Content contract (F-01): `src/lib/content.ts`, `supabase/migrations/20260727205534_content_model.sql`, `context/archive/2026-07-27-seed-content-model/plan-brief.md`
- Conventions: `AGENTS.md` (API rules, `cn()`, migrations), `src/lib/supabase.ts` (env pattern), `src/pages/api/auth/signin.ts` (endpoint pattern)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: World map renders (guest lands)

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 55431c4
- [x] 1.2 Build + type-check passes: `npm run build` — 55431c4

#### Manual

- [x] 1.3 `/` shows the world map (no starter welcome); Zone 1 open, Zone 2 locked — 55431c4
- [x] 1.4 Fresh guest sees Zone 1 only; refresh preserves it — 55431c4
- [x] 1.5 Tampered cookie falls back to fresh default (no error page) — 55431c4
- [x] 1.6 Supabase unconfigured shows a friendly message, not a crash — 55431c4
- [x] 1.7 Map is keyboard-operable; locked checkpoints announced as locked — 55431c4

### Phase 2: Open a checkpoint — read the lesson / see the quiz

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 9e7512c
- [x] 2.2 Build + type-check passes: `npm run build` — 9e7512c
- [x] 2.3 Locked-zone gate: `lesson?zoneSlug=context-and-agents` → 403 (fresh guest); `zoneSlug=foundations` → lesson JSON — 9e7512c

#### Manual

- [x] 2.4 Zone 1 lesson checkpoint shows the lesson; back returns to map — 9e7512c
- [x] 2.5 Zone 1 quiz checkpoint shows 3 questions; no correct-answer hint in payload — 9e7512c
- [x] 2.6 Zone 2 checkpoints cannot be opened; direct quiz endpoint returns 403 — 9e7512c
- [x] 2.7 Lesson/quiz panels keyboard-navigable; focus lands in panel on open — 9e7512c

### Phase 3: Take the quiz → pass/fail → unlock

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Build + type-check passes: `npm run build`
- [x] 3.3 Grade gate + integrity: locked-zone grade → 403; correct `foundations` submission → `passed: true` + `Set-Cookie`
- [x] 3.4 Empty/partial answers → grade returns 400

#### Manual

- [x] 3.5 Passing Zone 1 quiz shows success panel; CTA → map with Zone 2 unlocked; refresh keeps it
- [x] 3.6 Failing shows wrong answers + unlimited retry; Zone 2 stays locked
- [x] 3.7 After unlock, Zone 2 checkpoints open and its endpoints return 200
- [x] 3.8 Full loop completable keyboard-only; pass/fail + unlock announced via `aria-live`
