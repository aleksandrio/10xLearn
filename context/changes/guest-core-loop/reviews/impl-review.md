<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Guest Core Loop (S-01)

- **Plan**: context/changes/guest-core-loop/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Tailwind classes concatenated instead of `cn()`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/game/QuizPanel.tsx:~178
- **Detail**: The quiz option `<label>` merges Tailwind classes with string concatenation (`"flex cursor-pointer… " + (selected ? … : …)`). AGENTS.md hard rule #2: "Merge Tailwind classes with the `cn()` helper from `@/lib/utils` — never concatenate class strings manually." Every other card in this slice (`WorldMap.tsx`) uses `cn()`; this is the one substantive convention violation.
- **Fix**: Wrap the option-label classes in `cn(...)` from `@/lib/utils` (base classes as first arg, the selected/unselected branch as a conditional arg).
- **Decision**: FIXED — added `cn` import and wrapped the option-label className in QuizPanel.tsx.

### F2 — Prod may sign cookies with the insecure dev-fallback secret

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/guest-progress.ts:24-31
- **Detail**: When `GUEST_PROGRESS_SECRET` is unset, `secret()` falls back to a hardcoded `DEV_FALLBACK_SECRET`. This is intentional and documented (the cookie stores non-sensitive "which zones unlocked" convenience state, and the plan made the var optional so the app boots un-configured). Risk: a misconfigured **production** deploy would silently sign with the publicly-known dev key, letting anyone forge an unlock cookie. Low blast radius today (guest state only, no account/data), but it becomes real once S-02 ties guest progress to accounts.
- **Fix**: In `secret()`, throw (or hard-warn) when `import.meta.env.PROD` and `GUEST_PROGRESS_SECRET` is unset, so a prod deploy fails loudly instead of using the dev key. Keep the dev fallback for local only.
- **Decision**: FIXED — `secret()` now throws in `import.meta.env.PROD` when the secret is unset (fail-closed); dev fallback kept for local. Reads degrade fail-safe (verify swallows → empty set); writes surface as 500. Dev key is never used in prod, so forging is impossible.

### F3 — Map-build query fan-out (1 + 2N) and a redundant zone fetch in grade

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/lib/game.ts:63-83; src/pages/api/game/grade.ts:39-46
- **Detail**: `buildMapModel` calls `getMissionByZone` per zone, and each of those runs two queries (zone-by-slug + mission), so painting the map is ~1 + 2N queries. In `grade.ts`, `getZones` is fetched then `getMissionByZone` re-queries the zone by slug even though the zone row is already in hand. Immaterial at this app's <1 qps guest scale; flagged only so it's on record before the map grows.
- **Fix**: Resolve the mission from the already-fetched `zones` list (pass the zone id into a mission lookup), or batch missions in one query if/when the zone count grows.
- **Decision**: FIXED — added `getMissionByZoneId` to content.ts (getMissionByZone now delegates to it); `buildMapModel` uses `zone.id` and `grade.ts` resolves the zone from the already-fetched `zones` list, dropping the redundant zone-by-slug lookups.

## Notes

- **Plan adherence:** every planned item across all 3 phases verified MATCH — no MISSING, no DRIFT, no scope creep against the "What We're NOT Doing" list.
- **Security invariants hold:** earned-access gate re-verified server-side on every endpoint (direct call to a locked zone → 403); unlock derived server-side from zone order (never client-supplied); Web Crypto only (no `node:crypto`); answer key never leaves the DB (public view + grading RPC); cookie flags correct (`httpOnly`/`sameSite=lax`/`secure`-in-prod), tamper → fail-safe empty set.
- **Documented adaptations judged sound:** typing `createClient<Database>` in `supabase.ts`; locating the "first zone always unlocked" default in `game.ts` (DB-aware) rather than the DB-agnostic cookie helper.
- **Success criteria:** `npm run lint` clean, `npm run build` complete, endpoint gates 403/200 re-confirmed; all Manual Progress rows `[x]` with observable evidence (curl + user walkthrough).
