# Persist Progress with Sign-up — Plan Brief

> Full plan: `context/changes/persist-progress-with-signup/plan.md`

## What & Why

After the guest core loop (S-01), a learner can create an account — email + password or Google OAuth — and have their zone unlocks and quiz-pass results saved and resumed on their next login. This closes US-01's persistence guardrail ("unlocks and quiz results survive a browser close and session restart") and delivers FR-001..003. Without it, the guest's earned progress evaporates when they close the tab.

## Starting Point

S-01 is fully built: guest progress lives in an HMAC-signed `guest_progress` cookie (a set of unlocked zone slugs), read by `index.astro` and written by `grade.ts`; neither consults the logged-in user. Email/password auth is scaffolded (`signin`/`signup`/`signout`); OAuth is not. The DB holds only read-only content tables — there is no per-user table anywhere.

## Desired End State

A guest who unlocks Zone 2, signs up, closes the browser, and logs back in sees Zone 2 already unlocked — read from the database, keyed to their account, nothing reset. Google is a working sign-in option, and a learner can reset their password and delete their account. Guests who never sign up are completely unaffected.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| OAuth scope | Google only, now | Closes FR-002 with the most common provider; one callback route serves future providers | Plan |
| Data model | `mission_completions` (row per pass) | Captures "quiz result" as a first-class event and is where S-03 XP hangs off later | Plan |
| Source of truth | DB when authed, cookie for guests | Clean separation, no dual-write drift, guest path untouched | Plan |
| Merge strategy | Union / furthest-frontier wins | Never loses progress in either direction (new signup or returning login) | Plan |
| Merge point | Middleware, first authed request | Sidesteps the email-confirm timing gap; one place covers every auth path | Plan |
| Sign-out state | Reset to guest baseline | Unlocks belong to the account, not the device; login restores from DB | Plan |
| Signup nudge | Header entry + post-unlock nudge | Hits peak investment without gating play (FR-001 defer-the-wall intent) | Plan |
| RLS | Owner-only (`auth.uid() = user_id`) | A learner can never read/write another's progress; enforced at the DB | Plan |
| Account management | In scope (reset/profile/delete) | Explicit user request beyond FR-001..003 | Plan |
| XP | Deferred to S-03 | Stays its own roadmap slice; the data model supports it without rework | Plan |

## Scope

**In scope:** per-user unlock/completion persistence; DB-authoritative map for authed users; guest→account union-merge; Google OAuth; guest signup nudge; account management (password reset, minimal profile, deletion).

**Out of scope:** XP (S-03); cross-device concurrent-conflict UI; OAuth providers beyond Google; anti-cheat hardening.

## Architecture / Approach

A new `mission_completions` table (owner-only RLS, FK cascade on `auth.users`) becomes the second source of truth. `src/lib/progress.ts` owns the **pure** completion⇄unlock derivation (unit-tested) plus DB accessors. The two existing call sites (`index.astro` read, `grade.ts` write) branch on `locals.user`: authed → DB (reusing `buildMapModel`'s existing slug-set seam verbatim), guest → untouched cookie. Middleware is the single choke point that union-merges a present guest cookie into the account then clears it — covering email/pw-confirm, returning login, and OAuth uniformly. Google OAuth adds a trigger + a provider-agnostic `/api/auth/callback`. Account deletion uses a server-only service-role admin client.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + helpers | `mission_completions` table, RLS, pure derivation logic | Getting the derivation rule right (unit-tested) |
| 2. DB read/write | Authed map + grade use the DB; guests unchanged | Two code paths drifting |
| 3. Merge in middleware | Guest progress folds into the account, once, idempotently | The flagged handoff risk — contained to one place |
| 4. Google OAuth | Working "Continue with Google" | External Supabase provider config dependency |
| 5. Signup nudge UI | Header entry + post-unlock prompt for guests | Minor a11y wiring |
| 6. Account management | Password reset, profile, deletion | Deletion needs the service-role key |

**Prerequisites:** S-01 done (it is). For runtime: Google provider configured in Supabase, and `SUPABASE_SERVICE_ROLE_KEY` set for deletion.
**Estimated effort:** ~2–3 after-hours sessions across 6 phases.

## Open Risks & Assumptions

- Google OAuth won't complete end-to-end until the provider is configured in Supabase (code is ready; config is a manual prerequisite).
- Account deletion requires a service-role secret server-side; if that's unavailable in the deploy env, deletion must be rescoped.
- Assumes no existing production user data to migrate (true today).

## Success Criteria (Summary)

- A guest's unlock survives signup → browser close → login, read from the DB.
- Google sign-in works and merges guest progress on the callback.
- The guest-only loop is byte-for-byte unchanged (no regression), and the pure merge/derivation logic is unit-tested.
