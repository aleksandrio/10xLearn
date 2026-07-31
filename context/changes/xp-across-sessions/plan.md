# XP Across Sessions (S-03) Implementation Plan

## Overview

Learners earn XP for passing missions and see a running total that persists across
sessions (FR-010, nice-to-have). This is the deferred S-03 slice — the
`mission_completions` table was built in S-02 specifically to hang XP off later
(`completed_at` carries the comment *"present now so S-03 XP can read it without a
migration"*). XP is **derived** from the completion set, never stored as a running
total, matching the codebase's existing "derive unlocks from completions" idiom. It
surfaces in two places: a persistent badge on the world map and an animated "+X XP"
moment on a quiz pass — for both guests and authenticated learners.

## Current State Analysis

- **The completion set is the single source of truth.** For authed users it's the
  `mission_completions` rows (`src/lib/progress.ts:98-108`); for guests it's the set
  of unlocked slugs in a signed cookie, from which completions are *implied*
  (`impliedCompletionsFromUnlocked`, `src/lib/progress.ts:55-68`).
- **Unlocks are already derived, not stored** — pure, unit-tested functions in
  `src/lib/progress.ts` reconcile completions ⇄ unlocks. XP follows the same shape:
  a pure function of the completion set.
- **XP exists nowhere today.** No `xp_value` column, no total-XP function, no XP in
  any API response or component. All greenfield, but small.
- **The three touch points are clean:**
  - Write/grade: `src/pages/api/game/grade.ts:61-79` records a pass and returns
    `{ ...result, unlockedZones }`.
  - Map read (SSR): `src/pages/index.astro:20-23` builds the unlocked set and passes
    `initialZones` to `WorldMap`.
  - Quiz result: `src/components/game/QuizPanel.tsx:11-17` (`GradeResult`) and the
    success panel at `:116-133`; `WorldMap.handleUnlocked` (`:42-45`) applies the
    grade response to the map.
- **Content is seeded with fixed UUIDs** (`supabase/seed.sql`) — two zones/missions
  today; a `truncate ... db reset` re-seeds deterministically.
- **Pure-logic tests co-locate** at `src/lib/progress.test.ts` (Vitest, `@/*` alias,
  no DB — pure functions over `(zones, missionIdByZone, set)`).

### Key Discoveries:

- `mission_completions` needs **no migration** — the XP total reads its existing rows
  (`supabase/migrations/20260731160947_mission_completions.sql:11-17`).
- `buildMissionIdByZone` (`src/lib/progress.ts:75-90`) already produces the
  zone→mission lookup both derivation paths need; an XP-value lookup is the analogous
  `missionId → xp_value` map.
- Guest XP is **free**: `impliedCompletionsFromUnlocked` already turns the guest
  cookie into a completed-mission set — feed that to the same pure XP sum. No cookie
  format change, no schema change for guests.
- Idempotency is automatic for the *total* (derived from a `unique(user_id,
  mission_id)` set), but the **per-pass "+X XP" delta must be 0 on a re-pass** — see
  Critical Implementation Details.

## Desired End State

A learner (guest or signed-in) passes a mission and sees an animated "+X XP" in the
success panel; the map badge shows their accumulated total, which survives a browser
close and a re-login (authed: read from the DB; guest: from the 30-day signed
cookie). Re-passing an already-cleared mission awards 0 and the total does not
inflate. The guest-only and authed loops are otherwise unchanged.

**Verification:** pass Zone 1's quiz as a guest → see "+10 XP" and a "10 XP" badge;
pass Zone 2 → badge reads "30 XP"; re-open Zone 1's quiz and pass again → "+0 XP"
(or no gain shown), badge still "30 XP". Sign up, close browser, log back in → badge
still "30 XP", read from `mission_completions`.

## What We're NOT Doing

- **No stored XP column** (`mission_completions.xp_earned`) — XP is derived. (Chosen
  over a snapshot; see Key Decisions.)
- **No XP levels, thresholds, tiers, or progress-to-next-level bar** — out of FR-010
  scope; would introduce a level concept.
- **No confetti/particle burst** — "tasteful animated gain" only.
- **No dashboard XP stat** — the `/dashboard` page is untouched this slice (map +
  quiz surfaces only).
- **No leaderboard / social** — cut from MVP (PRD Non-Goals).
- **No change to the guest cookie format** — guest XP is derived from the unlocks it
  already carries.
- **No new anti-cheat** — the existing server-side grading gate is reused as-is.

## Implementation Approach

Add one column (`missions.xp_value`) and one pure function (`xpFromCompletions`) plus
its DB-reading wrappers in `progress.ts`, mirroring the existing unlock-derivation
functions one-for-one. The grade endpoint and the SSR map page each already compute a
completion/unlock set at exactly the point XP is needed — XP computation slots in
beside them with no new query path invented (same `mission_completions` read, same
`missions` read, plus the `xp_value` column). The two UI surfaces consume two new
numbers (`xpEarned`, `totalXp`) threaded through the existing grade response and the
existing `initialZones`/`onUnlocked` props.

## Critical Implementation Details

- **Per-pass delta must be 0 on a re-pass.** The XP *total* is idempotent because it
  derives from a `unique(user_id, mission_id)` set, but the "+X XP" moment must not
  claim `xp_value` when the mission was already complete. Detect a genuinely new
  completion at grade time: for authed users, have `recordCompletion` report whether
  it inserted a row (the `ignoreDuplicates` upsert returns the inserted row(s) via
  `.select()`, and an ignored conflict returns none); for guests, a new completion is
  exactly the case where the just-passed mission's next zone was **not** already in
  the unlocked set. `xpEarned = wasNewCompletion ? missionXpValue : 0`.
- **Reduced motion.** The animated gain must be gated behind `motion-safe:` (or a
  `prefers-reduced-motion` check), consistent with the map's existing
  `motion-safe:animate-bounce`/`animate-pulse` usage (`WorldMap.tsx:227,297`).

## Phase 1: Schema + XP Derivation

### Overview

Give missions an XP value and add the pure derivation + DB readers, fully unit-tested
in isolation before any endpoint or component consumes them.

### Changes Required:

#### 1. Migration — add `missions.xp_value`

**File**: `supabase/migrations/<timestamp>_mission_xp_value.sql` (new)

**Intent**: Add an integer XP value to each mission so XP can be weighted per mission
(and later tuned) rather than a hard-coded constant. Existing rows must remain valid
without a re-seed.

**Contract**: `alter table missions add column xp_value int not null default 10;` A
positive default so every already-seeded mission is immediately worth 10. No RLS
change (missions already have public read). Follow the timestamp-prefix filename
convention of the two existing migrations.

#### 2. Seed — escalating per-mission values

**File**: `supabase/seed.sql`

**Intent**: Seed the two existing missions with escalating XP (foundations = 10,
context-and-agents = 20) so progression feels weighted — a small game-feel signal that
later zones are worth more. Deterministic re-seed on `db reset`.

**Contract**: Add `xp_value` to the `insert into missions (...)` column list and
values (10 for `prompting-basics`, 20 for `working-with-context`). Keeps the fixed
UUIDs untouched.

#### 3. Pure XP sum + DB readers

**File**: `src/lib/progress.ts`

**Intent**: Add the pure `completions → total XP` function (the unit-tested core) and
the DB-reading wrappers that build the `xp_value`-by-mission lookup and produce a
total for an authed user and for a guest's cookie-implied completions.

**Contract**:
- `xpFromCompletions(xpByMissionId: Map<string, number>, completedMissionIds: Set<string>): number`
  — pure; sums `xp_value` for each completed mission id present in the map; ignores
  ids with no value. This is the sibling of `unlockedSlugsFromCompletions`.
- A helper that reads `missions(id, xp_value)` into `Map<string, number>` (analogous
  to `buildMissionIdByZone`).
- `getTotalXpForUser(supabase, userId): Promise<number>` — reads the user's
  `mission_completions` ids + the xp map, applies `xpFromCompletions`.
- `getGuestTotalXp(supabase, cookieUnlocked: Set<string>): Promise<number>` — reuses
  `impliedCompletionsFromUnlocked` (already exported) to get the guest's completed set,
  then applies `xpFromCompletions`.
- `recordCompletion` returns whether a new row was inserted (e.g. `Promise<boolean>`)
  by adding `.select("id")` to the existing upsert and checking the returned row count
  — so the grade endpoint can compute the per-pass delta. This is its only caller
  (`grade.ts`).

#### 4. Unit tests for the pure sum

**File**: `src/lib/progress.test.ts`

**Intent**: Lock down `xpFromCompletions` the way the existing suite locks down the
unlock derivation.

**Contract**: New `describe("xpFromCompletions")` covering: empty completion set → 0;
single completion → its value; multiple → sum; a completed id absent from the xp map →
contributes 0; values differ per mission (weighting works). Reuse the existing
`zone`/`missionIdByZone` fixtures; add an `xpByMissionId` fixture.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (or project migrate command) succeeds
- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck` (or `astro check`)
- Linting passes: `npm run lint`

#### Manual Verification:

- After `db reset`, `select slug, xp_value from missions` shows `prompting-basics=10`,
  `working-with-context=20`.
- Existing `progress.test.ts` cases still pass (no regression in unlock derivation).

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding.

---

## Phase 2: Grade Endpoint Returns XP

### Overview

Extend the grade response with the XP just earned and the new total, for both the
authed and guest paths, without altering the unlock behavior.

### Changes Required:

#### 1. Compute and return XP on grade

**File**: `src/pages/api/game/grade.ts`

**Intent**: On a pass, determine whether it was a new completion, compute `xpEarned`
(the mission's `xp_value` if new, else 0) and the learner's new `totalXp`, and include
both in the JSON response. On a fail, both are 0 / current total.

**Contract**: Response shape becomes
`{ ...result, unlockedZones, xpEarned: number, totalXp: number }`.
- Authed branch (`:62-66`): `recordCompletion` now returns whether it inserted →
  `xpEarned = inserted ? missionXpValue : 0`; `totalXp = await getTotalXpForUser(...)`
  after the write.
- Guest branch (`:67-71`): `wasNew = next && !unlocked.has(next)` (computed before the
  `unlocked.add(next)`); `xpEarned = wasNew ? missionXpValue : 0`;
  `totalXp = await getGuestTotalXp(supabase, unlocked)` using the post-write set.
- `missionXpValue` comes from the mission already fetched at `:54` (extend the mission
  read to include `xp_value`, or look it up from the xp map).
- No change to the gate, the unlock derivation, or the error paths.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`

#### Manual Verification:

- Guest passes Zone 1 quiz → response JSON has `xpEarned: 10`, `totalXp: 10`.
- Guest passes Zone 2 → `xpEarned: 20`, `totalXp: 30`.
- Guest re-submits a pass for Zone 1 → `xpEarned: 0`, `totalXp` unchanged.
- Authed learner: same sequence against `mission_completions`; re-pass yields
  `xpEarned: 0`.
- A failing submission returns `xpEarned: 0` and the current `totalXp`.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Map XP Badge

### Overview

Render the accumulated XP total on the world map, computed at SSR time for both guest
and authed learners.

### Changes Required:

#### 1. Compute initial XP in SSR

**File**: `src/pages/index.astro`

**Intent**: Alongside the unlocked set already built at `:20-23`, compute the
learner's total XP (authed via `getTotalXpForUser`, guest via `getGuestTotalXp` on the
cookie-derived set) and pass it to the island. Keep it inside the existing try/catch so
a failure still shows the "unavailable" state.

**Contract**: `WorldMap` gains an `initialXp={number}` prop next to `initialZones`.

#### 2. XP badge on the map

**File**: `src/components/game/WorldMap.tsx`

**Intent**: Accept `initialXp`, hold it in state, and render a badge beside the
existing "{litCount} / {total} zones lit" pill (`:161-164`). Update it live when a pass
returns a new total (see Phase 4).

**Contract**: `Props` gains `initialXp: number`; a `const [xp, setXp] = useState(initialXp)`;
a sibling pill (e.g. "⚡ {xp} XP") using the existing amber pill styling. Shared for
guest and authed (both receive a number).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Component/unit tests pass: `npm run test`

#### Manual Verification:

- Fresh guest on the map (no unlocks) shows "0 XP".
- After passing Zone 1, reloading the map shows "10 XP" (SSR from the cookie).
- Authed learner with prior completions sees their correct total on first paint.
- Badge is keyboard-reachable/screen-reader labelled consistent with the sibling pill.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Quiz "+X XP" Animated Moment

### Overview

Reward the pass moment with a tasteful animated XP gain in the success panel, and push
the new total up to the map badge so it's current when the learner returns.

### Changes Required:

#### 1. Consume XP in the quiz result

**File**: `src/components/game/QuizPanel.tsx`

**Intent**: Read `xpEarned`/`totalXp` from the grade response and show an animated
"+X XP" in the success panel (`:116-133`), gated for reduced motion. Suppress or
neutralize the display when `xpEarned` is 0 (a re-pass) so it never shows "+0 XP" as a
reward.

**Contract**: `GradeResult` (`:11-17`) gains `xpEarned: number; totalXp: number`. The
success panel renders the animated gain (count-up or rise-and-fade) using
`motion-safe:` utilities; reduced-motion falls back to the static number. `onUnlocked`
is extended to also carry the new total (e.g. `onUnlocked(graded.unlockedZones, graded.totalXp)`).

#### 2. Update the badge live

**File**: `src/components/game/WorldMap.tsx`

**Intent**: When a pass reports a new total, update the badge state so returning to the
map shows the updated XP immediately.

**Contract**: `handleUnlocked` (`:42-45`) signature extended to accept the new total and
call `setXp(...)`; `onUnlocked` prop type updated to match Phase 4 change #1.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Component/unit tests pass: `npm run test`

#### Manual Verification:

- Passing a quiz shows an animated "+10 XP" (or "+20") in the success panel.
- With `prefers-reduced-motion: reduce`, the gain shows statically (no animation).
- Returning to the map, the badge reflects the new total without a page reload.
- Re-passing an already-cleared mission shows no "+0 XP" reward and leaves the badge
  unchanged.
- Screen reader announces the XP gain alongside the existing pass announcement
  (`:108-114`).

**Implementation Note**: Final phase — pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `xpFromCompletions`: empty → 0; single; sum of several; completed id missing from xp
  map → 0; per-mission weighting (different values sum correctly).
- Existing `progress.test.ts` unlock-derivation cases remain green (regression guard).

### Integration Tests:

- Manual end-to-end via the running app (no automated integration harness exists in the
  repo today): guest pass → XP appears and persists over reload; sign up → total
  carries to the DB; re-pass → no inflation.

### Manual Testing Steps:

1. Guest: pass Zone 1 → "+10 XP" animates, map badge reads "10 XP".
2. Guest: pass Zone 2 → "+20 XP", badge "30 XP".
3. Guest: reopen Zone 1 quiz, pass again → no "+0 XP" reward, badge still "30 XP".
4. Sign up, close browser, log back in → badge still "30 XP" (from `mission_completions`).
5. Toggle `prefers-reduced-motion` → gain shows without animation.

## Performance Considerations

XP is a read-time sum over the learner's completion set (a handful of rows at MVP
scale, `<1` qps). The SSR path adds one `missions(id, xp_value)` read and the grade
path adds one total recompute — both negligible and well within the ~800 ms p95 NFR.
No new hot path.

## Migration Notes

Single additive column with a non-null default (`10`) — existing `mission_completions`
and `missions` rows remain valid with no backfill. No production user data to migrate
(none exists yet). Rollback is dropping the column; the derived-XP code has no other
schema dependency.

## References

- Roadmap slice: `context/foundation/roadmap.md` S-03 (`:104-114`)
- PRD: FR-010 (`context/foundation/prd.md:93-94`)
- Prior slice this builds on: `context/archive/2026-07-31-persist-progress-with-signup/`
- Derivation pattern to mirror: `src/lib/progress.ts:27-68`
- Table built for this: `supabase/migrations/20260731160947_mission_completions.sql:15`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema + XP Derivation

#### Automated

- [x] 1.1 Migration applies cleanly (`db reset`/migrate) — 6292656
- [x] 1.2 Unit tests pass (`npm run test`) — 6292656
- [x] 1.3 Type checking passes — 6292656
- [x] 1.4 Linting passes — 6292656

#### Manual

- [ ] 1.5 Seeded `xp_value` values correct (10 / 20)
- [ ] 1.6 Existing unlock-derivation tests still pass

### Phase 2: Grade Endpoint Returns XP

#### Automated

- [x] 2.1 Type checking passes — 35e90f3
- [x] 2.2 Linting passes — 35e90f3
- [x] 2.3 Unit tests pass — 35e90f3

#### Manual

- [ ] 2.4 Guest pass returns correct `xpEarned`/`totalXp`
- [ ] 2.5 Re-pass returns `xpEarned: 0`, total unchanged
- [ ] 2.6 Authed pass/re-pass behave identically against the DB
- [ ] 2.7 Failing submission returns `xpEarned: 0`

### Phase 3: Map XP Badge

#### Automated

- [x] 3.1 Type checking passes — 3be596a
- [x] 3.2 Linting passes — 3be596a
- [x] 3.3 Component/unit tests pass — 3be596a

#### Manual

- [ ] 3.4 Fresh guest shows "0 XP"; after Zone 1 shows "10 XP" on reload
- [ ] 3.5 Authed learner's prior total shows on first paint
- [ ] 3.6 Badge is keyboard/screen-reader accessible

### Phase 4: Quiz "+X XP" Animated Moment

#### Automated

- [x] 4.1 Type checking passes — 9a86071
- [x] 4.2 Linting passes — 9a86071
- [x] 4.3 Component/unit tests pass — 9a86071

#### Manual

- [ ] 4.4 Animated "+X XP" shows on pass
- [ ] 4.5 Reduced-motion falls back to static
- [ ] 4.6 Map badge updates live on return
- [ ] 4.7 Re-pass shows no "+0 XP" reward
- [ ] 4.8 Screen reader announces the XP gain
