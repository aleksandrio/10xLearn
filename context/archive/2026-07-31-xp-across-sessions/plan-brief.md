# XP Across Sessions (S-03) — Plan Brief

> Full plan: `context/changes/xp-across-sessions/plan.md`

## What & Why

Learners earn XP for passing missions and see a running total that accumulates and
survives a browser close and re-login (FR-010, nice-to-have). It reinforces the core
loop cheaply and rides on progress data S-02 already persists — the
`mission_completions` table was built with this slice in mind.

## Starting Point

S-02 is done: completions are the single source of truth. Authed learners' passes live
in `mission_completions` (owner-RLS); guests' passes are *implied* from the unlocked
slugs in their signed 30-day cookie. Unlocks are already **derived** from that
completion set via pure, unit-tested functions in `src/lib/progress.ts`. XP exists
nowhere yet — no column, no function, no UI.

## Desired End State

A learner (guest or signed-in) passes a mission, sees an animated "+X XP" in the
success panel, and a persistent badge on the map shows their total. The total persists
across sessions (authed: from the DB; guest: from the cookie) and never inflates on a
re-pass. The guest-only and authed loops are otherwise unchanged.

## Key Decisions Made

| Decision            | Choice                                   | Why (1 sentence)                                                            | Source |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | ------ |
| XP value model      | Per-mission `missions.xp_value` (10/20)  | Game-like weighting — later zones worth more; one small additive migration | Plan   |
| Compute method      | Derived from completions (not stored)    | Matches the codebase's "derive unlocks, don't store" idiom; no drift       | Plan   |
| Guest XP            | Yes — derived from cookie-implied completions | Consistent reward with zero cookie/schema change; strengthens signup nudge | Plan   |
| UI surfaces         | Map header badge + quiz "+X XP" moment   | The always-visible score (FR-010) plus the achievement payoff              | Plan   |
| Feel                | Tasteful animated gain, reduced-motion safe | Game-feel reward matching the map's existing motion-safe animations        | Plan   |
| Re-pass delta       | `xpEarned = 0` when not a new completion | Total is idempotent; the "+X XP" moment must not lie on a re-pass          | Plan   |
| Dashboard XP        | Out of scope this slice                  | Map + quiz are the primary surfaces; dashboard is secondary                | Plan   |

## Scope

**In scope:** `missions.xp_value` column + seed; pure `xpFromCompletions` + DB/guest
readers in `progress.ts` (unit-tested); grade endpoint returns `xpEarned`/`totalXp`;
map XP badge (SSR, guest+authed); animated "+X XP" quiz moment with live badge update.

**Out of scope:** stored XP column; XP levels/thresholds/progress bar; confetti;
dashboard stat; leaderboard; cookie-format changes; new anti-cheat.

## Architecture / Approach

One additive column (`missions.xp_value`) and one pure function (`xpFromCompletions`)
plus DB/guest wrappers in `progress.ts` — sibling-for-sibling with the existing
unlock-derivation functions. XP is computed at the two points that already build a
completion/unlock set: the grade endpoint (returns `xpEarned` + new `totalXp`) and the
SSR map page (passes `initialXp` to `WorldMap`). The quiz panel and map badge consume
two new numbers threaded through the existing grade response and `onUnlocked` prop. No
new query path or state store is invented.

## Phases at a Glance

| Phase                         | What it delivers                                          | Key risk                                            |
| ----------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| 1. Schema + XP derivation     | `xp_value` column + seed; pure sum + readers; unit tests | Getting the pure sum right (unit-tested)            |
| 2. Grade endpoint returns XP  | `xpEarned` + `totalXp` in the grade response             | Per-pass delta must be 0 on a re-pass               |
| 3. Map XP badge               | Persistent XP total on the map (guest + authed, SSR)     | Guest vs authed both reduced to one number — low    |
| 4. Quiz "+X XP" moment        | Animated gain + live badge update                        | Reduced-motion + suppressing "+0 XP" on re-pass     |

**Prerequisites:** S-02 done (it is). Local Supabase for `db reset` to seed values.
**Estimated effort:** ~1 after-hours session across 4 small phases.

## Open Risks & Assumptions

- The re-pass delta (0 XP) relies on detecting a *new* completion — for authed via the
  upsert's returned rows, for guests via "next zone wasn't already unlocked." Both are
  covered in Critical Implementation Details.
- Guest XP is only as durable as the 30-day cookie — acceptable, same as guest unlocks
  today.
- Assumes no production data to backfill (true); the column default (10) covers any
  existing rows.

## Success Criteria (Summary)

- Passing a mission shows an animated "+X XP" and a persistent map badge with the total.
- The total persists across browser close / re-login and never inflates on a re-pass.
- The pure XP sum is unit-tested and the existing guest/authed loops are unregressed.
