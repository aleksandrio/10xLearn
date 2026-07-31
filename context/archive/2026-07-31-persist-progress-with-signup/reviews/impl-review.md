<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Persist Progress with Sign-up (email/pw or OAuth)

- **Plan**: context/changes/persist-progress-with-signup/plan.md
- **Scope**: All 6 phases (full plan)
- **Date**: 2026-07-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations (F9 added during triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — UPDATE RLS policy on `mission_completions` has no `with check`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260731160947_mission_completions.sql:31-32
- **Detail**: The UPDATE policy is `using (auth.uid() = user_id)` with no `with check (...)`. `using` only gates which rows are visible to update; without `with check`, an authenticated user could UPDATE their own row and set `user_id` to another user's id. The app never UPDATEs this table (writes are `upsert` with `ignoreDuplicates`, which resolve to INSERT via the unique conflict), and the `(user_id, mission_id)` unique + FK cap the blast radius — but the policy is incomplete. The plan itself under-specified this (it listed UPDATE `using(...)` only), so this is also a plan flaw.
- **Fix A ⭐ Recommended**: Drop the UPDATE policy entirely — the app only ever inserts.
  - Strength: Removes an unused, mis-scoped policy and shrinks the write surface to exactly what the code uses (INSERT). No behavior change.
  - Tradeoff: A future feature that legitimately updates a row would need to re-add a (correct) policy.
  - Confidence: HIGH — grep confirms only upsert/insert usage in progress.ts; no UPDATE path exists.
  - Blind spot: None significant.
- **Fix B**: Add `with check (auth.uid() = user_id)` to the UPDATE policy.
  - Strength: Keeps the policy the plan named, closes the id-reassignment hole.
  - Tradeoff: Retains a policy the code never exercises.
  - Confidence: HIGH — standard RLS completion.
  - Blind spot: None significant.
- **Note**: The first migration is already applied locally; fix via editing the migration + `npm run db:reset` (safe — plan states no production data yet) or a new follow-up migration if the DB is shared.
- **Decision**: FIXED via Fix A — dropped the UPDATE policy from the migration; `npm run db:reset` re-applied cleanly.

### F2 — reset-request / update-password: unguarded form inputs; reset-request can 500 instead of the neutral "sent" page

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/reset-request.ts:15,22 ; src/pages/api/auth/update-password.ts:9
- **Detail**: Both read `form.get(...) as string` with no null/type guard. Worse, `reset-request.ts` has no try/catch, so a transport-level throw from `resetPasswordForEmail` (Supabase down, network) would 500 the request rather than land on the neutral `?sent=1` page — which undermines the (otherwise correct) anti-enumeration design. This matches the *legacy* signin/signup `as string` shortcut but not the newer validated pattern in `grade.ts` (zod + safeParse).
- **Fix**: Guard for a missing field, and wrap `reset-request` so any throw still redirects to `?sent=1` (keep the neutral response); mirror the redirect-with-error convention for `update-password`.
- **Decision**: FIXED — added field guards to both; wrapped `resetPasswordForEmail` in try/catch keeping the neutral `?sent=1`; `update-password` now rejects a too-short/missing password with a redirect-with-error.

### F3 — OAuth `redirectTo` origin fallback is not PROD-guarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/oauth.ts:17
- **Detail**: `const origin = PUBLIC_SITE_URL ?? context.url.origin;` — `PUBLIC_SITE_URL` is `optional: true`, so in a misconfigured deploy the OAuth `redirectTo` is built from the attacker-influenceable request origin/Host. Mitigated server-side by Supabase's own redirect allow-list, so real risk is low, but relying on request origin in production is fragile and inconsistent with the repo's own fail-closed pattern.
- **Fix**: In `import.meta.env.PROD`, require `PUBLIC_SITE_URL` and fail closed (mirror the `secret()` PROD-guard in `src/lib/guest-progress.ts`) instead of silently falling back to the request origin.
- **Decision**: FIXED — added `src/lib/site-url.ts` `resolveSiteOrigin(requestOrigin)`: uses `PUBLIC_SITE_URL` when set, falls back to request origin only in dev, returns null (fail closed) in PROD when unset. Applied to both `oauth.ts` (redirect to sign-in with error on null) and `reset-request.ts` (stays neutral `?sent=1` on null). Config note surfaced separately (F9).

### F4 — Unplanned test-infra changes (vitest alias + stub)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: vitest.config.ts, vitest.astro-env-server.stub.ts
- **Detail**: The plan's file list did not include test-infra changes, but `progress.test.ts` (a planned deliverable) cannot run under Vitest — Vite can't resolve the `astro:env/server` virtual module. A resolve alias + inert stub were added to unblock the planned tests. Benign and necessary; no assertion weakened. Also benign: the "Continue with Google" button was factored into a shared `GoogleButton.tsx` rather than inlined in each form, and `progress.test.ts` adds two extra coverage cases beyond the five required.
- **Fix**: Document the vitest-infra addition as a plan addendum so future reviews treat it as in-scope (no code change).
- **Decision**: FIXED — added a "Deviations from plan (addenda)" section to plan.md recording the vitest-infra, shared GoogleButton, and the two post-review fixes.

### F5 — N+1 in `buildMissionIdByZone` (paid twice per authed grade)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/progress.ts:74-82 (via getUnlockedZoneSlugsForUser:90-100, mergeGuestUnlocksIntoAccount:120-127)
- **Detail**: One `getMissionByZoneId` query per zone (parallelised, but N round-trips). Runs on every authed map render, twice per authed grade (gate check + post-record recompute), and on every authed request until the guest cookie clears. Acceptable at <1 qps and consistent with the pre-existing `buildMapModel` N+1 in `game.ts`, but tech debt.
- **Fix**: Collapse to a single `missions` query ordered by zone `order_index` and build the map in memory.
- **Decision**: FIXED — `buildMissionIdByZone` now runs one ordered `missions` query and keeps the earliest row per `zone_id`; removed the per-zone `getMissionByZoneId` calls (and its import).

### F6 — Middleware catch says "Log-and-continue" but logs nothing

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:32-34
- **Detail**: Fail-open is the right call (a merge hiccup must not 500 a page load, and the cookie is retained for retry — both correct). But the catch block is empty despite the "Log-and-continue" comment, so a persistently-failing merge is invisible.
- **Fix**: Add a `console.error` in the catch to match the stated intent.
- **Decision**: FIXED — catch now logs via `console.error` (scoped `eslint-disable no-console` for the intentional operational log).

### F7 — No CSRF protection on state-changing POST endpoints

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/delete-account.ts (and signout, update-password, oauth)
- **Detail**: Delete-account is correctly a POST with a `locals.user` identity check, and the admin client is never client-reachable — good. There is no CSRF token / Origin / Sec-Fetch-Site check on state-changing POSTs. Largely mitigated by SameSite=Lax auth cookies (Lax does **not** send cookies on cross-site POST form submissions), so exposure is low; this is a codebase-wide, pre-existing defense-in-depth gap, not new to this change. Highest value on delete-account.
- **Fix**: Add an Origin/Sec-Fetch-Site check in middleware for state-changing POSTs (or a CSRF token). Track as codebase-wide follow-up.
- **Decision**: FIXED — middleware now rejects (403) any POST/PUT/PATCH/DELETE whose `Origin` header is present and mismatches `context.url.origin`; requests with no `Origin` fall through (SameSite=Lax backstop). Same-origin form/fetch POSTs unaffected.

### F8 — Legacy auth endpoints missing `export const prerender = false`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts, signup.ts, signout.ts
- **Detail**: Every new endpoint in this change correctly declares `export const prerender = false;`. The three pre-existing endpoints do not. With `output: "server"` this is harmless (server is the default), but the new files set the explicit convention and the old ones are now the odd ones out.
- **Fix**: Add `prerender = false` to the three legacy endpoints (out of scope for this change; worth a follow-up).
- **Decision**: FIXED — added `export const prerender = false;` to signin.ts, signup.ts, signout.ts.

### F9 — Local Supabase auth `site_url` / redirect allow-list doesn't match the app's dev port

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: supabase/config.toml:154,156
- **Detail**: Surfaced while checking site-url handling for F3. Local Supabase `[auth]` has `site_url = "http://127.0.0.1:3000"` and `additional_redirect_urls = ["https://127.0.0.1:3000"]`, but Astro's dev server defaults to `:4321` (no port override in astro.config.mjs / package.json). Supabase only redirects to allow-listed URLs, so with the current config the OAuth callback (`/api/auth/callback`) and the password-reset link (`/auth/update-password`) built from the dev origin (`http://localhost:4321/...`) would be **rejected** locally — the Manual checks 4.3–4.5 and 6.4 can't pass until this is aligned. Deploy env has the same requirement (must allow-list the real callback URL). This is manual local/infra config, not app code.
- **Fix**: Align the local dev origin and the Supabase allow-list — either run the app on `:3000` (`astro dev --port 3000`) or update `supabase/config.toml` `site_url`/`additional_redirect_urls` to the app's actual dev origin (e.g. `http://localhost:4321`), then `supabase stop && supabase start`. Set `PUBLIC_SITE_URL` + the deploy allow-list in production.
- **Decision**: FIXED — set `site_url = "http://localhost:4321"` and `additional_redirect_urls = ["http://localhost:4321","http://127.0.0.1:4321"]` in supabase/config.toml; restarted the local stack. Deploy env still needs `PUBLIC_SITE_URL` + its own allow-list (manual prerequisite).

## Notes

- Agent-flagged "guest→account merge loses the frontier zone" was investigated and **dismissed as a false positive**: `impliedCompletionsFromUnlocked` records the previous zone's completion, from which the frontier's unlock is re-derived, so the post-merge unlocked set is identical to the guest's pre-merge set (verified for single- and multi-zone frontiers).
- Positives confirmed: service-role key is correctly server-only (`context: "server", access: "secret"`, never imported client-side); answer-key isolation preserved (grading still via RPC); grade.ts recomputes the unlocked set from the DB after `recordCompletion`; `reset-request` is correctly non-enumerating; `progress.ts` idempotent/monotonic upserts make the fail-open middleware retry safe; strong a11y in WorldMap; delete relies on FK cascade for progress cleanup.
