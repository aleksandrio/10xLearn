<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Seeded Content Model (F-01)

- **Plan**: context/changes/seed-content-model/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-07-27
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Hardcoded `total = 3` couples pass/fail to a fixed question count

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260727205534_content_model.sql:96
- **Detail**: The `grade_mission_quiz` pass gate is `v_correct = v_total and v_total = 3`. This matches the plan's Phase 1 contract verbatim ("`correct_count = total AND total = 3`"), so it is NOT drift — but it is a latent trap: any mission that ever has a number of questions other than 3 can never return `passed: true`, silently. The seed ships exactly 3 questions per mission, so it is correct today; the risk surfaces the moment S-02/S-03 or future content adds a mission with a different question count.
- **Fix**: Drop the `and v_total = 3` clause so the gate is `v_correct = v_total and v_total > 0` (all questions correct, mission non-empty). This decouples correctness from a magic count while preserving today's behavior for 3-question missions. Note: the plan explicitly specified `total = 3`, so this is also a plan-level refinement worth recording.
  - Strength: Removes a silent-failure class; grading stays correct as content grows.
  - Tradeoff: Diverges from the plan's literal contract — the plan text should be noted as superseded.
  - Confidence: HIGH — the `> 0` guard preserves the "empty mission never passes" property the `total = 3` check was standing in for.
  - Blind spot: None significant — no consumer depends on the literal `3`.

### F2 — `truncate table zones cascade` in seed is destructive if mis-run outside local

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: supabase/seed.sql:9
- **Detail**: `truncate table zones cascade` empties zones → missions → lessons → quiz_questions (via `on delete cascade`). This is intentional and correct for idempotent local `db reset` re-seeding (and Supabase only runs `seed.sql` on `db reset` by default, so normal workflow is contained). The residual risk is purely operational: if someone ever runs `seed.sql` by hand against a shared/staging/prod DB, it silently destroys all content. The plan scoped this change local-only, so this is a guardrail note, not a defect.
- **Fix**: Keep as-is (local-only intent is documented at seed.sql:3-4); optionally strengthen the header comment to explicitly warn "destructive — local `db reset` only, never run against a shared DB."
  - Strength: Preserves the idempotency the seed relies on with zero behavior change.
  - Tradeoff: Relies on process discipline rather than a hard guard.
  - Confidence: HIGH — matches the plan's documented local-only scope and Supabase's default seed workflow.
  - Blind spot: No technical block exists if someone deliberately runs the file out of band.

### F3 — `gradeQuiz` casts the RPC result through `unknown` with no runtime shape check

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/content.ts:114-119
- **Detail**: `p_answers: answers as unknown as Json` and `return data as unknown as QuizResult` are unavoidable given the RPC types `p_answers`/`Returns` as opaque `Json` in the generated types. The runtime shape isn't validated — if the RPC's return contract ever drifts, callers receive a mistyped object with no error at the boundary. Acceptable now (RPC and `QuizResult` interface are authored together and verified by the Phase 3 script), but worth a lightweight guard if this data ever reaches an untrusted rendering path.
- **Fix**: Optionally add a small runtime shape check (or a `zod` parse) on the RPC result before returning; defer unless/until S-01 renders it in a security-sensitive context.
- **Decision**: PENDING

## Notes

- **No plan drift, missing items, or scope creep** across all six planned artifacts (migration, seed, generated types, `content.ts`, `package.json` scripts, eslint ignore). The load-bearing security decisions — RLS-locked `quiz_questions` base table with no client policy, `quiz_questions_public` view created without `security_invoker` (owner-run, RLS-bypassing), SECURITY DEFINER RPC with pinned `search_path`, answer key never in any payload — are all implemented exactly as specified and independently confirmed against the generated types.
- **Answer-key isolation is airtight** on both paths: read path (base table returns 0 rows to anon; view exposes only 5 safe columns) and grading path (RPC returns only booleans/counts, never `correct_option_id`; no dynamic SQL). Verified via `set role anon` SQL and the Phase 3 verification script.
- **Success criteria (fresh re-run):** `npm run lint` exit 0; `npx astro check` 0 errors / 0 warnings; row counts z=2 m=2 l=2 q=6; `quiz_questions_public` confirmed to omit `correct_option_id`. All 20 Progress rows `[x]`; 6 manual rows confirmed by the user.
- **Environment (not repo-tracked):** shell defaults to Node 20.19.1 but the project requires Node ≥22 (`.nvmrc` pins 22.14.0) — this was the root cause of the initial "20 lint errors" (missing `.astro/types.d.ts`), resolved by `astro sync` under Node 22. No git repository exists, so no commits were made and `/10x-archive` will not run until git is initialized.

## Decisions

### F1 — Hardcoded `total = 3`
- **Decision**: FIXED — gate changed to `v_correct = v_total and v_total > 0` (migration:96); re-verified via db reset (correct→pass, wrong→fail, empty→fail).

### F2 — `truncate ... cascade` in seed
- **Decision**: FIXED — added explicit "DESTRUCTIVE / local db reset only / never run against a shared DB" warning above the truncate (seed.sql:9). Comment-only, no behavior change.

### F3 — `gradeQuiz` unchecked RPC cast
- **Decision**: SKIPPED (deferred) — revisit if S-01 renders this data in a security-sensitive path.
