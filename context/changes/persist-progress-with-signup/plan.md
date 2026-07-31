# Persist Progress with Sign-up (email/pw or OAuth) — Implementation Plan

## Overview

After the guest core loop (S-01), a learner can create an account — email + password (already scaffolded) or Google OAuth — and have their zone unlocks and quiz-pass results saved to the database, then resume exactly where they left off on their next login. This closes US-01's persistence guardrail ("unlocks and quiz results survive a browser close and session restart") and delivers FR-001 (sign-up half), FR-002 (email/pw + OAuth), and FR-003 (login and resume).

The load-bearing design move: introduce a **second source of truth** — a per-user `mission_completions` table — and reconcile it with the existing signed guest cookie. Authenticated learners read/write the DB; guests keep the S-01 cookie path unchanged; and a guest who signs up has their in-session progress **merged forward** into their new account (never lost).

Account management (password reset, minimal profile, account deletion) is included by explicit user request, scoped to the minimum. XP persistence remains deferred to S-03.

## Current State Analysis

What exists today (verified against the codebase, 2026-07-31):

- **Guest progress is a signed cookie, not DB state.** `src/lib/guest-progress.ts` owns an HMAC-signed `guest_progress` cookie carrying a `Set<string>` of unlocked zone *slugs* (beyond the always-free first zone). `readUnlockedZones` / `writeUnlockedZones` are the only accessors; both are server-side, fail-safe, and Web-Crypto-only (Cloudflare workerd — no `node:crypto`).
- **The map read/write path is guest-only.** `src/pages/index.astro:15` reads the cookie → `buildMapModel(supabase, unlocked)` → `WorldMap` island. `src/pages/api/game/grade.ts:38-57` reads the cookie, grades via the `grade_mission_quiz` RPC, and on a pass adds the next zone slug to the cookie set. **Neither consults `locals.user`.**
- **`buildMapModel(supabase, unlocked: Set<string>)`** (`src/lib/game.ts:63`) is source-agnostic — it takes an unlocked-slug set regardless of where it came from. This is the seam the DB path plugs into.
- **DB has only read-only content.** `supabase/migrations/20260727205534_content_model.sql` defines `zones → missions → lessons → quiz_questions` + the key-omitting `quiz_questions_public` view + the `grade_mission_quiz` SECURITY DEFINER RPC. There is **no per-user table** anywhere. RLS discipline is established: public read on content, quiz base table locked.
- **Email/password auth is scaffolded; OAuth is not.** `src/pages/api/auth/{signin,signup,signout}.ts` wire `signInWithPassword` / `signUp` / signout. Signup → `/auth/confirm-email` (dev auto-confirms via `import.meta.env.DEV`); signin → `/`. There is **no `signInWithOAuth`, no `/api/auth/callback`** (grep-confirmed). `src/lib/supabase.ts` builds one SSR client from the **anon key** (`SUPABASE_KEY`); there is no service-role client.
- **Middleware** (`src/middleware.ts`) resolves `locals.user` on every request and protects only `/dashboard`.
- **Tooling:** `npm test` → `vitest run` (jsdom; `src/lib/utils.test.ts` is the pattern). `npm run lint` → `eslint .`. `npx astro check` type-checks. `npm run db:reset` re-runs migrations + `supabase/seed.sql`. `npm run db:types` regenerates `src/db/database.types.ts` from the local DB.

## Desired End State

- A guest plays Zone 1 → unlocks Zone 2 → signs up (email/pw or Google) → their Zone 2 unlock is now in the DB, keyed to their account.
- They close the browser, return, log in → the map renders Zone 2 already unlocked, read from the DB. Nothing reset.
- Passing a quiz while logged in records a `mission_completions` row; the unlock is derived from completions.
- A guest who never signs up is unaffected — the S-01 cookie path is byte-for-byte the same.
- Google is a working sign-in option alongside email/password.
- A learner can reset their password, see a minimal profile, and delete their account (which cascades their progress away).

**Verification of end state:** the full manual E2E in Testing Strategy passes; the pure merge/derivation logic is unit-tested; `astro check`, `eslint`, and `vitest` are green.

### Key Discoveries:

- `buildMapModel` already accepts an unlocked-slug `Set` (`src/lib/game.ts:63`) — the DB path only needs to *produce that set* from completions; no rewrite of map assembly.
- `nextZoneSlug` / `isZoneUnlocked` (`src/lib/game.ts:32,52`) already encode play-order unlock rules — the completion⇄unlock derivation reuses them.
- The SSR client (`src/lib/supabase.ts`) carries the user's JWT via cookies, so `auth.uid()` resolves in RLS policies for reads and writes made through it — no service-role needed for normal progress I/O.
- **Account deletion is the one operation the anon client cannot do**: `auth.admin.deleteUser` requires the service-role key (see Critical Implementation Details).
- Dev auto-confirms email (`confirm-email.astro`), so a merge that fires on *first authenticated request* (not at signup submit) works uniformly for email/pw and OAuth without special-casing the confirmation gap.

## What We're NOT Doing

- **XP** (FR-010 / S-03) — no XP award, storage, or display. The `mission_completions` schema is shaped so XP hangs off it later (a `completed_at` timestamp + per-mission rows) without a migration rewrite.
- **Cross-device concurrent-edit conflict handling** — union-merge + DB-authoritative covers it implicitly at <1 qps; no explicit conflict UI.
- **OAuth providers beyond Google** — the callback route is built provider-agnostic so adding GitHub/etc. later is Supabase config, not code.
- **Anti-cheat / quiz-integrity hardening** — PRD Non-Goal; unchanged.
- **Migrating existing guest cookies at scale** — there is no production user data yet; merge is per-session on login.

## Implementation Approach

Layered, DB-first, each phase independently verifiable:

1. **Schema + pure logic first** (Phase 1) — the table, RLS, and the *pure* completion⇄unlock derivation functions land before any wiring, so the risky reconciliation logic is unit-testable in isolation.
2. **Swap the source of truth behind the existing seam** (Phase 2) — branch the two call sites (`index.astro`, `grade.ts`) on `locals.user`; authed → DB, guest → untouched cookie. `buildMapModel` is reused verbatim.
3. **Merge at the one choke point that sees every auth path** (Phase 3) — middleware, gated on `user && guest-cookie-present`, idempotent, then clears the cookie. This is the fiddly bit the roadmap flagged; it lives in exactly one place.
4. **Add Google OAuth** (Phase 4) — a trigger + a provider-agnostic callback; the merge from Phase 3 fires automatically on the resulting session.
5. **Surface the entry points to guests** (Phase 5) — persistent header + post-unlock nudge.
6. **Account management** (Phase 6) — password reset, minimal profile, deletion (with a service-role admin client for the delete).

## Critical Implementation Details

**Completion ⇄ unlock derivation (pure, unit-tested — the highest-risk logic).** Zones are ordered `z0, z1, …`; `z0` is always unlocked (free); passing `zi`'s mission unlocks `z(i+1)`.
- **completions → unlocked slugs** (map render for authed users): `unlocked = {z0.slug} ∪ { nextZone(zi).slug : zi.mission ∈ completed }`. Equivalently a zone is unlocked iff it is first OR the previous zone's mission is completed.
- **cookie unlocked-slugs → implied completions** (merge): for each zone `zi`, if `nextZone(zi).slug ∈ cookieSet` then `zi.mission` was passed → mark it completed. The frontier unlocked zone itself contributes no completion (it may be unlocked but not yet passed). Skip zones with no mission.
These are pure functions over `(zonesInOrder, missionIdByZone, set)` — no DB, no I/O — so they unit-test like `utils.test.ts`.

**Merge idempotency.** The merge upserts completions with `on conflict (user_id, mission_id) do nothing`; union of completion sets is monotonic, so re-running is a no-op. It is gated on the guest cookie being present and clears the cookie on success — so after the first authenticated request it costs nothing.

**Account deletion needs the service role.** The request-scoped anon client cannot delete an `auth.users` row; `supabase.auth.admin.deleteUser(id)` requires `SUPABASE_SERVICE_ROLE_KEY`. The delete endpoint constructs a **separate, server-only admin client** with that key (never exposed to the browser, added to the env schema as a server secret). `mission_completions.user_id references auth.users(id) on delete cascade` makes the user-row delete carry the progress away automatically.

**Middleware safety.** The merge runs inside `onRequest` for authed requests; it must never throw the request into a 500 — wrap in try/catch, fail open (log-and-continue), and skip when `supabase` is null.

## Phase 1: Persistence schema + RLS + query helpers

### Overview

Create the `mission_completions` table with owner-only RLS, regenerate DB types, and add `src/lib/progress.ts` housing the pure derivation logic plus the DB accessors.

### Changes Required:

#### 1. Progress migration

**File**: `supabase/migrations/<timestamp>_mission_completions.sql` (new)

**Intent**: Add the per-user progress table that records which missions a learner has passed, isolated per user by RLS, and cleaned up automatically when an account is deleted.

**Contract**: Table `mission_completions` with `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `mission_id uuid not null references missions(id) on delete cascade`, `completed_at timestamptz not null default now()`, and `unique (user_id, mission_id)`. Enable RLS. Three policies scoped `to authenticated`: SELECT `using (auth.uid() = user_id)`, INSERT `with check (auth.uid() = user_id)`, UPDATE `using (auth.uid() = user_id)`. No `anon` access. (`completed_at` is present now so S-03 XP can read it without a migration.)

#### 2. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new table in the generated types so `progress.ts` is fully typed.

**Contract**: Run `npm run db:reset` then `npm run db:types`. `Database["public"]["Tables"]["mission_completions"]` exists afterward. Do not hand-edit.

#### 3. Progress query + derivation module

**File**: `src/lib/progress.ts` (new)

**Intent**: One module owning both the pure completion⇄unlock derivation and the DB reads/writes, mirroring the `content.ts` convention (functions take the shared `ContentClient`).

**Contract**: Pure functions — `unlockedSlugsFromCompletions(zones, missionIdByZone, completedMissionIds): Set<string>` and `impliedCompletionsFromUnlocked(zones, missionIdByZone, unlockedSlugs): Set<string>` (see Critical Implementation Details for the exact rule). DB functions — `getUnlockedZoneSlugsForUser(supabase, userId): Promise<Set<string>>` (reads completions, joins zone order, applies the pure fn), `recordCompletion(supabase, userId, missionId): Promise<void>` (idempotent upsert), and `mergeGuestUnlocksIntoAccount(supabase, userId, cookieUnlocked): Promise<void>` (translates cookie set → implied completions → idempotent upsert). Reuse `getZones` and `nextZoneSlug` from the existing modules.

### Success Criteria:

#### Automated Verification:

- Migration + seed apply cleanly: `npm run db:reset`
- Types regenerate without error and include `mission_completions`: `npm run db:types`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- In the Supabase Studio SQL editor, confirm a non-owner cannot select another user's `mission_completions` rows (RLS denies).
- Confirm deleting a test user in Studio cascades away their `mission_completions` rows.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: DB-authoritative read/write for authed users

### Overview

Branch the map read (`index.astro`) and the grade write (`grade.ts`) on `locals.user`: authenticated learners read/write `mission_completions`; guests keep the exact S-01 cookie path. Unit-test the pure derivation.

### Changes Required:

#### 1. Map render reads DB for authed users

**File**: `src/pages/index.astro`

**Intent**: When a user is logged in, derive the unlocked-slug set from their DB completions instead of the guest cookie, then feed it to the unchanged `buildMapModel`.

**Contract**: If `Astro.locals.user`, `unlocked = await getUnlockedZoneSlugsForUser(supabase, user.id)`; else the existing `readUnlockedZones(cookie)` path. `buildMapModel(supabase, unlocked)` is called identically in both branches.

#### 2. Grade endpoint persists for authed users

**File**: `src/pages/api/game/grade.ts`

**Intent**: On a pass, an authenticated learner's completion is recorded in the DB (and the effective unlocked set is derived from the DB); a guest's pass writes the cookie exactly as before.

**Contract**: Resolve `user` from `context.locals`. Gate check uses the DB-derived unlocked set for authed users, the cookie set for guests. On pass: authed → `recordCompletion(supabase, user.id, mission.id)` then recompute effective set via `getUnlockedZoneSlugsForUser`; guest → existing `unlocked.add(next)` + `writeUnlockedZones`. The JSON response shape (`{ ...result, unlockedZones }`) is unchanged so `WorldMap` needs no change here.

#### 3. Unit tests for derivation

**File**: `src/lib/progress.test.ts` (new)

**Intent**: Lock down the completion⇄unlock derivation — the highest-risk logic — against regressions.

**Contract**: Cover `unlockedSlugsFromCompletions` and `impliedCompletionsFromUnlocked`: empty set → first zone only; first-mission complete → first two zones unlocked; round-trip (unlocked → implied completions → unlocked) is stable; frontier zone contributes no completion; zones without a mission are skipped.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Logged in, pass a quiz → the next zone unlocks on the map; reload → still unlocked (read from DB).
- As a guest (no account), the loop behaves exactly as in S-01 (cookie-driven) — no regression.
- Directly POSTing `grade` for a locked zone while authed returns 403 (gate uses DB set).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Guest→account merge in middleware

### Overview

When an authenticated request arrives carrying a guest cookie, union-merge the cookie's unlocks into the account's completions (idempotent), then clear the cookie. This is the single choke point that covers signup-then-confirm, returning login, and OAuth alike.

### Changes Required:

#### 1. Merge step in middleware

**File**: `src/middleware.ts`

**Intent**: Fold any in-session guest progress into the logged-in account exactly once, resiliently, without special-casing the auth path or the email-confirmation timing gap.

**Contract**: After `locals.user` is resolved, if `user && supabase && guest cookie present`: read the cookie's unlocked set, call `mergeGuestUnlocksIntoAccount(supabase, user.id, cookieSet)`, then delete the `guest_progress` cookie. Wrap in try/catch — never fail the request; skip silently when the cookie is absent (the common steady state). Order the merge before `next()`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`

#### Manual Verification:

- As a guest, unlock Zone 2, then sign up and confirm/login → Zone 2 is unlocked from the DB and the `guest_progress` cookie is gone (check dev tools).
- Sign in on an account that is *behind* the current guest cookie → union wins (further frontier retained); sign in on an account *ahead* of the cookie → DB state retained (no downgrade).
- Repeated reloads after merge do not duplicate rows or error (idempotent).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Google OAuth

### Overview

Add Google as a sign-in option: a trigger that calls `signInWithOAuth('google')` and a provider-agnostic `/api/auth/callback` route that exchanges the code for a session. The Phase 3 merge fires automatically on the resulting authenticated request.

### Changes Required:

#### 1. OAuth callback route

**File**: `src/pages/api/auth/callback.ts` (new)

**Intent**: Complete the OAuth round-trip by exchanging the returned code for a Supabase session, then land the user on the map.

**Contract**: `GET` handler reads `code` from the query string, calls `supabase.auth.exchangeCodeForSession(code)`, and redirects to `/` on success or `/auth/signin?error=…` on failure. Provider-agnostic (no Google-specific logic), so future providers reuse it.

#### 2. OAuth trigger endpoint

**File**: `src/pages/api/auth/oauth.ts` (new)

**Intent**: Start the OAuth flow server-side so the redirect URL is built from the request origin.

**Contract**: `POST` handler calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: <origin>/api/auth/callback } })` and redirects to the returned `data.url`.

#### 3. OAuth button in auth forms

**File**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: Give learners a "Continue with Google" action on both auth pages.

**Contract**: A button that POSTs to `/api/auth/oauth` (a small form or fetch-then-redirect), styled consistently with the existing form. No secrets in client code.

#### 4. Env schema for site URL (if needed)

**File**: `astro.config.mjs`, `.env.example`

**Intent**: Make the OAuth redirect origin explicit for the deployed environment.

**Contract**: Add an optional server `PUBLIC_SITE_URL` (or reuse request origin) used to build `redirectTo`; document in `.env.example`. Local Supabase Google provider config is a manual prerequisite (see Migration Notes).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- "Continue with Google" completes the round-trip and lands on the map as an authenticated user (requires Google provider configured in Supabase — see Migration Notes).
- Signing in via Google after guest play merges the guest unlock (Phase 3 fires on the callback session).
- A failed/cancelled OAuth returns to `/auth/signin` with an error, not a 500.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Guest signup nudge UI

### Overview

Surface the auth entry points to guests: a persistent sign-in/up affordance on the map, plus a contextual "save your progress" nudge after a guest passes a quiz and unlocks a zone.

### Changes Required:

#### 1. Pass auth state into the map island

**File**: `src/pages/index.astro`, `src/components/game/WorldMap.tsx`

**Intent**: Let the island know whether the viewer is authenticated so it can show the right affordance.

**Contract**: `index.astro` passes `isAuthenticated={!!Astro.locals.user}` to `WorldMap`; `WorldMap` accepts the new prop.

#### 2. Persistent header entry + post-unlock nudge

**File**: `src/components/game/WorldMap.tsx` (and a small presentational component if warranted)

**Intent**: For guests, always show a sign in / sign up link in the map header, and after an unlock show a "Save your progress — sign up" prompt at the moment of peak investment. Authenticated users see neither.

**Contract**: When `!isAuthenticated`: render a header link to `/auth/signup` (+ `/auth/signin`); after `handleUnlocked` fires for a guest, surface a dismissible nudge linking to sign-up. Keyboard-operable and labelled (respect the existing a11y patterns in the component). No change to the unlock data flow.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`

#### Manual Verification:

- As a guest, the header shows sign in / sign up; after unlocking a zone, the "save your progress" nudge appears and links to sign-up.
- As an authenticated user, neither the header link nor the nudge appears.
- The nudge and header link are reachable and operable by keyboard.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Account management

### Overview

Add password reset (request + update), a minimal profile, and account deletion. Deletion uses a server-only service-role admin client; the FK cascade removes progress.

### Changes Required:

#### 1. Password-reset request

**File**: `src/pages/auth/forgot-password.astro` (new), `src/pages/api/auth/reset-request.ts` (new)

**Intent**: Let a learner request a reset email.

**Contract**: A form collecting the email; the endpoint calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/auth/update-password })` and redirects to a "check your email" confirmation. Mirror the existing auth-page styling.

#### 2. Password update

**File**: `src/pages/auth/update-password.astro` (new), `src/pages/api/auth/update-password.ts` (new)

**Intent**: Complete the reset by setting a new password for the session established from the reset link.

**Contract**: A form collecting the new password; the endpoint calls `supabase.auth.updateUser({ password })` and redirects to `/auth/signin` on success.

#### 3. Minimal profile

**File**: `src/pages/dashboard.astro` (extend)

**Intent**: Give the learner a place to see their account and reach delete/reset — reuse the existing authenticated dashboard rather than a new page.

**Contract**: Extend the existing dashboard (already shows `user.email`) with links to change/reset password and to delete the account. No new route.

#### 4. Account deletion

**File**: `src/pages/api/auth/delete-account.ts` (new), `src/lib/supabase-admin.ts` (new), `astro.config.mjs`, `.env.example`

**Intent**: Permanently delete the learner's auth account; their `mission_completions` cascade away via the FK.

**Contract**: `supabase-admin.ts` builds a server-only client from `SUPABASE_SERVICE_ROLE_KEY` (added to the env schema as a server secret; documented in `.env.example`; never imported into client code). The `POST` delete endpoint confirms the caller is `locals.user`, calls `admin.auth.admin.deleteUser(user.id)`, signs the session out, and redirects to `/`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`

#### Manual Verification:

- Request a password reset → receive/see the reset link (dev inbucket) → set a new password → sign in with it.
- Delete an account → the user can no longer sign in, and their `mission_completions` rows are gone (verify in Studio).
- The delete endpoint rejects unauthenticated callers.
- `SUPABASE_SERVICE_ROLE_KEY` never appears in the client bundle (grep the build output).

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `unlockedSlugsFromCompletions` and `impliedCompletionsFromUnlocked` — empty, first-mission-passed, round-trip stability, frontier-contributes-nothing, missionless-zone skipped.
- Merge is a union: seeding an account behind the cookie advances it; seeding ahead of the cookie does not downgrade.

### Integration / Manual Testing Steps:

1. Guest: land on map (Zone 1 unlocked, Zone 2 locked) → read lesson → pass quiz → Zone 2 unlocks.
2. Sign up (email/pw) → confirm (dev auto) → log in → **Zone 2 still unlocked from DB**; `guest_progress` cookie cleared.
3. Close browser, reopen, log in → progress intact.
4. Repeat 1–2 via "Continue with Google".
5. Sign out → map resets to guest baseline (Zone 1 only); log back in → progress restored.
6. Password reset round-trip; account deletion round-trip (progress cascades away).
7. Regression: full guest loop with no account behaves exactly as S-01.

### Edge cases to verify manually:

- Direct `grade` POST to a locked zone while authed → 403.
- Merge idempotency across reloads (no dup rows, no errors).
- OAuth cancel → graceful return to sign-in.

## Performance Considerations

At <1 qps the added per-request work is negligible. The middleware merge is gated on the guest cookie being present and clears it on success, so it runs effectively once per account and is a no-op thereafter. Map render for authed users adds one indexed query over `mission_completions` (small; unique index on `(user_id, mission_id)`). Watch the ~800 ms p95 NFR on quiz-submit → unlock, now one extra insert + one derive query for authed users — well within budget.

## Migration Notes

- New migration is additive (a new table); no changes to existing content tables. `npm run db:reset` re-applies migrations + seed locally; the same migration applies to the remote DB on deploy.
- **Google OAuth is a manual prerequisite**: configure the Google provider (client id/secret, authorized redirect) in the Supabase project (and `supabase/config.toml` `[auth.external.google]` for local), and set the redirect/site URL. Code is ready without it, but the flow won't complete until configured.
- **`SUPABASE_SERVICE_ROLE_KEY`** must be set in the deploy environment for account deletion; it is a server secret and must never reach the client.

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-02 (the guest→account handoff risk is called out there).
- PRD: `context/foundation/prd.md` — US-01, FR-001, FR-002, FR-003, Access Control, Success Criteria (persistence guardrail).
- Prior slice: `context/changes/guest-core-loop/plan.md` (S-01 — the cookie path this builds on).
- Guest cookie: `src/lib/guest-progress.ts`; map assembly seam: `src/lib/game.ts:63`; grade write: `src/pages/api/game/grade.ts:54-57`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persistence schema + RLS + query helpers

#### Automated

- [x] 1.1 Migration + seed apply cleanly: `npm run db:reset`
- [x] 1.2 Types regenerate and include `mission_completions`: `npm run db:types`
- [x] 1.3 Type checking passes: `npx astro check`
- [x] 1.4 Linting passes: `npm run lint`

#### Manual

- [ ] 1.5 RLS denies cross-user select of `mission_completions` (verified in Studio)
- [ ] 1.6 Deleting a test user cascades away their `mission_completions` rows

### Phase 2: DB-authoritative read/write for authed users

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Type checking passes: `npx astro check`
- [ ] 2.3 Linting passes: `npm run lint`

#### Manual

- [ ] 2.4 Authed pass unlocks next zone; reload keeps it (from DB)
- [ ] 2.5 Guest loop unchanged from S-01 (no regression)
- [ ] 2.6 Authed `grade` POST to a locked zone returns 403

### Phase 3: Guest→account merge in middleware

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Unit tests pass: `npm test`

#### Manual

- [ ] 3.4 Guest unlock survives signup/login via merge; cookie cleared
- [ ] 3.5 Union wins both directions (no downgrade, no loss)
- [ ] 3.6 Merge idempotent across reloads (no dup rows / errors)

### Phase 4: Google OAuth

#### Automated

- [ ] 4.1 Type checking passes: `npx astro check`
- [ ] 4.2 Linting passes: `npm run lint`

#### Manual

- [ ] 4.3 "Continue with Google" completes and lands authenticated on the map
- [ ] 4.4 Guest unlock merges on the Google callback session
- [ ] 4.5 Cancelled/failed OAuth returns to sign-in gracefully (no 500)

### Phase 5: Guest signup nudge UI

#### Automated

- [ ] 5.1 Type checking passes: `npx astro check`
- [ ] 5.2 Linting passes: `npm run lint`
- [ ] 5.3 Unit tests pass: `npm test`

#### Manual

- [ ] 5.4 Guest sees header entry + post-unlock nudge; authed sees neither
- [ ] 5.5 Nudge and header link are keyboard-operable and labelled

### Phase 6: Account management

#### Automated

- [ ] 6.1 Type checking passes: `npx astro check`
- [ ] 6.2 Linting passes: `npm run lint`
- [ ] 6.3 Unit tests pass: `npm test`

#### Manual

- [ ] 6.4 Password reset round-trip works (request → update → sign in)
- [ ] 6.5 Account deletion removes the user and cascades progress away
- [ ] 6.6 Delete endpoint rejects unauthenticated callers
- [ ] 6.7 `SUPABASE_SERVICE_ROLE_KEY` absent from the client bundle
