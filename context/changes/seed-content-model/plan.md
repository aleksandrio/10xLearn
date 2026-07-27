# Seeded Content Model (F-01) Implementation Plan

## Overview

Define and seed a **read-only** content data model — zones → missions → lessons → quiz questions — so the guest core loop (S-01) renders real content instead of placeholders. This is a data-layer foundation: a Supabase migration, a seed file, generated TypeScript types, and a small typed query module. It ships the shared content contract that S-01 renders, S-02's progression records reference by mission, and S-03's XP attributes to missions.

The one hard boundary from the roadmap: **content only.** No progression, persistence, or XP tables — those belong to S-02/S-03. Over-modeling the content schema now is the named risk; the mitigation is to seed and model only what Zone 1–2 need to prove the loop.

## Current State Analysis

The codebase is a bootstrapped 10x Astro Starter with a **virgin Supabase setup** and no domain data layer:

- **Supabase client**: `src/lib/supabase.ts:5` exposes `createClient(requestHeaders, cookies)` built on `@supabase/ssr`'s `createServerClient`; returns `null` when env vars are absent. All server code (API routes, middleware) consumes this factory.
- **No schema**: `supabase/config.toml` has `[db.migrations] schema_paths = []`, no `supabase/migrations/` directory, and no `supabase/seed.sql` — even though `[db.seed] sql_paths = ["./seed.sql"]` already references it (`enabled = true`).
- **No DB types**: there is no `src/db/database.types.ts` or equivalent; the Supabase client is currently untyped.
- **Established patterns to match**: API routes call `createClient(context.request.headers, context.cookies)` then use the client (`src/pages/api/auth/signin.ts:9`); middleware populates `context.locals.user` (`src/middleware.ts`); path alias `@/*` → `src/*` (`tsconfig.json`); `astro:env/server` declares `SUPABASE_URL` / `SUPABASE_KEY` as server-only secrets (`astro.config.mjs`).
- **Local dev path**: Docker + `npx supabase start`; Studio at `http://localhost:54323` (README). `supabase` CLI v2.23.4 is a devDependency; `@supabase/supabase-js` v2.99.1, `@supabase/ssr` v0.10.3.
- **Deploy target**: Cloudflare adapter, `output: "server"`.

### Key Discoveries:

- **Migrations run from `supabase/migrations/*.sql`** via `supabase db reset` (applies migrations, then seed) — this is the mechanism regardless of the `schema_paths` setting, which governs the separate *declarative* schema feature and can stay `[]`. (`supabase/config.toml`)
- **The quiz answer key is the sensitive field.** The no-passive-passthrough guardrail (PRD §Guardrails, FR-008) requires the correct answer never ship to the browser. This drives the view-omits-key + `SECURITY DEFINER` grading RPC design.
- **Unlock state is NOT content.** Which zone is "unlocked" is per-learner progression state (S-01 in-session, S-02 persisted). Content carries only `order_index` to define the linear sequence; the loop derives lock/unlock from ordering + progression. No unlock column here. (roadmap F-01, PRD FR-006)
- **Postgres view security default is a footgun** — see Critical Implementation Details. A view created by the `postgres` owner runs with `security_invoker = off` by default and thus bypasses RLS on its base table; this is exactly how the public view exposes safe quiz columns while the base table stays locked.

## Desired End State

Running `npx supabase db reset` locally applies one migration and the seed, producing:

- Four content tables (`zones`, `missions`, `lessons`, `quiz_questions`) with RLS enabled.
- Anonymous (guest) and authenticated clients can `SELECT` zones, missions, lessons, and quiz questions **without the correct-answer field** (via a `quiz_questions_public` view).
- A `grade_mission_quiz` RPC that grades a submission server-side and returns per-question correctness + pass/fail, **never returning the answer key**.
- Seed data: 2 zones (ordered), 1 mission + 1 lesson per zone, 3 quiz questions per mission — subject: AI-assisted development.
- `src/db/database.types.ts` generated from the live local schema.
- `src/lib/content.ts` exposing typed read helpers and a grade helper, all taking the existing `SupabaseClient`.

**Verification of end state**: a throwaway script (or a quick `supabase` SQL call) using the anon key reads zones/missions/lessons/quiz-via-view and confirms `correct_option_id` is absent from the payload; a call to `grade_mission_quiz` with a known-correct set returns `passed: true`, and with a wrong set returns `passed: false` — and neither response contains the correct answer.

## What We're NOT Doing

- **No progression / persistence / XP tables** — no `user_progress`, no unlock records, no XP. (S-02 / S-03.)
- **No UI** — no map, mission, lesson, or quiz components. (S-01.)
- **No API endpoints / pages** — the query module is a library, not a route. (S-01 wires it up.)
- **No auth or RLS changes tied to users** — content read policies are for `anon` + `authenticated`; nothing user-scoped.
- **No in-app authoring** — content is seed-only (PRD §Non-Goals).
- **No anti-cheat hardening** — the view/RPC prevents the *trivial* answer-key leak, but 3-question brute-force resistance is explicitly a v2 concern (PRD Open Question 1). We are only closing the "answer is in the payload" hole, not making the quiz brute-force-proof.
- **No production/remote DB push** — local `supabase` stack only; remote deploy is out of scope for this slice.

## Implementation Approach

Three sequential phases, each independently verifiable:

1. **Schema** — one migration file creating tables + RLS + the public view + the grading RPC. Everything structural lands atomically so the seed and types phases have a stable target.
2. **Seed** — `supabase/seed.sql` populating the two-zone content set. Kept in a separate file (Supabase's seed mechanism) so content can be edited/swapped without touching the schema migration.
3. **Types + query module + verification** — generate types from the live schema, write the typed `src/lib/content.ts` helpers against those types, and prove the anon read path + grading RPC behave (answer key hidden, grading correct).

The schema deliberately models `missions` and `quiz_questions` as `1→N` children (even though the seed ships one mission per zone and three questions per mission) because that is the natural domain shape and costs nothing extra to seed; `lessons` is a sibling child of `missions`. We stop there — no per-option table, no metadata columns beyond what Zone 1–2 render.

## Critical Implementation Details

- **Postgres view security default (load-bearing).** A view owned by `postgres` created *without* `WITH (security_invoker = on)` executes with the view owner's privileges and **bypasses RLS on `quiz_questions`**. This is intentional and is the mechanism that lets `anon` read safe quiz columns through `quiz_questions_public` while the base table has **no** `anon`/`authenticated` SELECT policy. Do NOT add `security_invoker = on` to this view, and do NOT add an anon SELECT policy to `quiz_questions` — either change would defeat the answer-key isolation. Grant SELECT on the *view* to `anon, authenticated`.
- **`options` JSONB must never contain the correct flag.** Each option is `{ "id": "...", "text": "..." }` only. Correctness lives solely in the separate `correct_option_id` column on the row. If correctness were embedded in the options JSONB, the public view could not hide it.
- **Ordering, not unlock state.** `zones.order_index` and `missions.order_index` / `quiz_questions.order_index` define sequence. There is no `is_unlocked` column anywhere — unlock is derived by the loop from progression state that does not exist yet.
- **Migration timestamp.** Supabase migration filenames are `<UTC-timestamp>_<name>.sql` (e.g. `20260727120000_content_model.sql`); the CLI orders by filename. Generate the timestamp at authoring time (`date -u +%Y%m%d%H%M%S`), don't hardcode a placeholder that sorts wrong.

## Phase 1: Schema Migration

### Overview

Create the four content tables, enable RLS with public read on the three non-sensitive tables, lock the `quiz_questions` base table, expose a key-omitting public view, and add a server-side grading RPC.

### Changes Required:

#### 1. Content-model migration

**File**: `supabase/migrations/<timestamp>_content_model.sql` (new)

**Intent**: Define the read-only content schema and its access surface in one migration so the seed and generated types have a stable target. Establishes the answer-key isolation that satisfies the no-passive-passthrough guardrail.

**Contract**:

- `zones`: `id uuid pk default gen_random_uuid()`, `slug text unique not null`, `title text not null`, `description text`, `order_index int not null` (unique). RLS enabled; policy `anon, authenticated` SELECT `using (true)`.
- `missions`: `id uuid pk`, `zone_id uuid not null references zones(id) on delete cascade`, `slug text unique not null`, `title text not null`, `order_index int not null`. RLS enabled; same public SELECT policy. Model as `1→N` from `zones` (seed ships one per zone).
- `lessons`: `id uuid pk`, `mission_id uuid not null references missions(id) on delete cascade`, `title text`, `body text not null` (markdown). RLS enabled; same public SELECT policy. One row per mission for the seed.
- `quiz_questions`: `id uuid pk`, `mission_id uuid not null references missions(id) on delete cascade`, `order_index int not null`, `prompt text not null`, `options jsonb not null` (array of `{id,text}`), `correct_option_id text not null`. RLS enabled; **no anon/authenticated policy** (base table unreadable by clients).
- `quiz_questions_public` VIEW: selects `id, mission_id, order_index, prompt, options` from `quiz_questions` (omits `correct_option_id`). Created by the migration owner *without* `security_invoker`; `GRANT SELECT ON quiz_questions_public TO anon, authenticated;`.
- `grade_mission_quiz(p_mission_id uuid, p_answers jsonb)` FUNCTION, `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`. Input `p_answers` = array of `{question_id, option_id}`. Returns a JSON object `{ passed boolean, correct_count int, total int, results: [{question_id, correct boolean}] }`. Pass condition: all questions for the mission answered correctly (`correct_count = total AND total = 3`). **Never returns `correct_option_id`.** `GRANT EXECUTE` to `anon, authenticated`.

A snippet is warranted only for the view + RPC seam that later phases depend on:

```sql
-- Public view: hides the answer key; runs as owner (do NOT set security_invoker=on)
create view quiz_questions_public as
  select id, mission_id, order_index, prompt, options
  from quiz_questions;
grant select on quiz_questions_public to anon, authenticated;

-- Server-side grading: answer key never leaves the database
create function grade_mission_quiz(p_mission_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total int; v_correct int; v_results jsonb;
begin
  select count(*) into v_total from quiz_questions where mission_id = p_mission_id;
  select
    coalesce(sum(case when q.correct_option_id = a.option_id then 1 else 0 end), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'question_id', q.id, 'correct', q.correct_option_id = a.option_id)), '[]'::jsonb)
  into v_correct, v_results
  from quiz_questions q
  join jsonb_to_recordset(p_answers) as a(question_id uuid, option_id text)
    on a.question_id = q.id
  where q.mission_id = p_mission_id;
  return jsonb_build_object('passed', v_correct = v_total and v_total = 3,
    'correct_count', v_correct, 'total', v_total, 'results', v_results);
end $$;
grant execute on function grade_mission_quiz(uuid, jsonb) to anon, authenticated;
```

#### 2. Confirm migration discovery

**File**: `supabase/config.toml`

**Intent**: Ensure the CLI applies the new migration and seed on `db reset`. Migrations are discovered from `supabase/migrations/` by default; `[db.seed]` already points at `./seed.sql`.

**Contract**: No change expected — verify `[db.seed] enabled = true` and `sql_paths = ["./seed.sql"]` are present. Leave `[db.migrations] schema_paths` as-is (declarative-schema feature, unrelated to versioned migrations). Only edit if verification shows discovery isn't happening.

### Success Criteria:

#### Automated Verification:

- Local stack up: `npx supabase start` succeeds.
- Migration applies cleanly with no seed yet: `npx supabase db reset` completes without error.
- Tables exist: querying `information_schema.tables` (via `npx supabase db reset` output or Studio SQL) shows `zones`, `missions`, `lessons`, `quiz_questions`.
- View exists and omits the key: `select * from quiz_questions_public limit 0;` succeeds and column list has no `correct_option_id`.
- RPC exists: `select grade_mission_quiz('00000000-0000-0000-0000-000000000000', '[]'::jsonb);` returns a JSON object (with `total = 0`).
- Lint passes: `npm run lint`.

#### Manual Verification:

- In Studio (`http://localhost:54323`), RLS is shown enabled on all four tables.
- A quick anon-key `select` against `quiz_questions` (base table) returns zero rows / permission-blocked, while `quiz_questions_public` is readable.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in `## Progress`.

---

## Phase 2: Seed Content

### Overview

Populate the content set that Zone 1–2 need to prove the loop: two ordered zones, one mission + one lesson each, and three quiz questions per mission, on the AI-assisted-development subject.

### Changes Required:

#### 1. Seed file

**File**: `supabase/seed.sql` (new)

**Intent**: Insert real, vettable content so S-01 renders a truthful demo and the unlock transition can be exercised end-to-end. Deterministic and idempotent enough to survive repeated `db reset`.

**Contract**:

- Zone 1 (`order_index = 1`, slug e.g. `foundations`) and Zone 2 (`order_index = 2`, slug e.g. `context-and-agents`) — titles/descriptions on the AI-assisted-dev subject.
- One mission per zone (`order_index = 1`), each with one lesson (`body` = short markdown, the content the quiz tests).
- Three `quiz_questions` per mission (`order_index` 1–3): `prompt`, `options` JSONB of 3–4 `{id,text}` entries, and a `correct_option_id` matching one option `id`. Questions must be answerable from that mission's lesson body (integrity: the answer is in the lesson, not general trivia).
- Use fixed UUIDs (or `gen_random_uuid()` with slug-based `where`) so foreign keys resolve within the seed. Prefer deterministic literals for FK wiring simplicity.

No snippet — this is straightforward `INSERT` following the schema contract from Phase 1.

### Success Criteria:

#### Automated Verification:

- Seed applies: `npx supabase db reset` runs migration + seed with no error.
- Row counts correct: `select count(*) from zones` = 2; `missions` = 2; `lessons` = 2; `quiz_questions` = 6.
- Referential integrity holds: every `missions.zone_id`, `lessons.mission_id`, `quiz_questions.mission_id` resolves (no orphan check errors).
- Every `quiz_questions.correct_option_id` matches an `id` present in that row's `options` JSONB (spot-checkable via SQL).
- Lint passes: `npm run lint`.

#### Manual Verification:

- Read the two lessons and six questions in Studio — each question is genuinely answerable from its mission's lesson body (integrity check), and Zone 1 reads as the natural starting zone.
- Content is on-brand (AI-assisted dev) and free of placeholder Lorem.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Types + Query Module + Verification

### Overview

Generate TypeScript types from the live schema, add a typed content-query module following the `@/lib` pattern, and prove the anon read path and grading RPC behave correctly (answer key hidden, grading accurate).

### Changes Required:

#### 1. Generated database types

**File**: `src/db/database.types.ts` (new, generated)

**Intent**: Give the app a source of truth for the schema so the query module and downstream S-01 code are type-checked and stay in sync.

**Contract**: Output of `npx supabase gen types typescript --local` written to `src/db/database.types.ts`. Add an npm script `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"` to `package.json` for regeneration. Optionally add `"db:reset": "supabase db reset"` for convenience. The generated file is committed (not gitignored).

#### 2. Typed content-query module

**File**: `src/lib/content.ts` (new)

**Intent**: Provide S-01 a ready, typed data API for reading content and grading quizzes, so the seed's read path is exercised and proven before S-01 depends on it. Follows the existing convention where callers pass the `createClient(...)` result.

**Contract**: Functions taking a `SupabaseClient` (typed with the generated `Database`) as first argument:

- `getZones(supabase)` → ordered zones (`order_index` asc).
- `getMissionByZone(supabase, zoneSlug)` (or `getMission(supabase, missionId)`) → mission + its lesson.
- `getQuizQuestions(supabase, missionId)` → questions read **from `quiz_questions_public`** (no answer key), `order_index` asc. Because the view isn't in the base generated types the way tables are, type its rows explicitly or select via the view name with an inline row type.
- `gradeQuiz(supabase, missionId, answers)` → calls the `grade_mission_quiz` RPC and returns its typed result.

Type the Supabase client as `SupabaseClient<Database>` from `@supabase/supabase-js` + the generated `Database` type. No snippet — this is straightforward typed query code against the Phase 1 contract.

#### 3. Read-path verification

**File**: throwaway script under the scratchpad dir (not committed) or a documented Studio/`supabase` SQL sequence.

**Intent**: Prove end-to-end that a guest (anon key) can read content, cannot see the answer key, and that grading returns correct pass/fail.

**Contract**: Using the anon key, read zones/missions/lessons and `quiz_questions_public`; assert `correct_option_id` is absent from every quiz payload. Call `grade_mission_quiz` with a fully-correct answer set (`passed: true`) and a wrong set (`passed: false`); assert neither response contains the answer key.

### Success Criteria:

#### Automated Verification:

- Types generate: `npm run db:types` writes `src/db/database.types.ts` with `zones`, `missions`, `lessons`, `quiz_questions` definitions.
- Type check passes: `npx astro check` (or `npm run build`) reports no type errors in `src/lib/content.ts`.
- Lint passes: `npm run lint`.
- Verification script: anon read returns the seeded zones and quiz questions **without** `correct_option_id`; `gradeQuiz` returns `passed: true` for a correct set and `passed: false` for a wrong set.

#### Manual Verification:

- `src/lib/content.ts` imports and typing match the existing `@/lib` conventions (client passed in, path alias, no client-side secret usage).
- The answer key is confirmed absent from every client-reachable payload (guardrail satisfied).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit / SQL-level Tests:

- `correct_option_id` for every quiz row references an existing option `id` in that row's `options` JSONB.
- `grade_mission_quiz` returns `passed: true` only when all three answers match; partial-correct returns `passed: false` with accurate `correct_count`.
- Foreign-key cascade: deleting a zone removes its missions/lessons/quiz (sanity, not a product feature).

### Integration Tests:

- Anon client can `SELECT` zones/missions/lessons and `quiz_questions_public`, and **cannot** read `quiz_questions` base table.
- `getZones` / `getMission` / `getQuizQuestions` / `gradeQuiz` return correctly typed results against the seeded data.

### Manual Testing Steps:

1. `npx supabase start` then `npx supabase db reset` — confirm migration + seed apply cleanly.
2. In Studio, open each table; confirm RLS enabled and row counts (2/2/2/6).
3. Run the verification script; confirm answer key never appears in any payload and grading is correct.
4. Read both lessons + all six questions; confirm each question is answerable from its lesson.

## Performance Considerations

Trivial at MVP scale (<1 qps, <1 GB, a handful of rows). No indexing beyond primary keys and the implicit FK indexes is needed; `order_index` sorts operate on tiny tables. The ~800 ms p95 NFR is a concern for the S-01 interaction path, not for this data layer.

## Migration Notes

- Local-only for this slice: `supabase/migrations/` + `supabase/seed.sql`, applied via `npx supabase db reset`. Remote/prod push is out of scope.
- The seed is re-applied on every `db reset`; keep it deterministic (fixed UUIDs) so re-runs are stable.
- Generated types (`src/db/database.types.ts`) must be regenerated (`npm run db:types`) whenever the schema changes — note this for S-02/S-03 which extend the schema.

## References

- Roadmap slice: `context/foundation/roadmap.md` §F-01 (lines 62–74)
- PRD: `context/foundation/prd.md` — FR-004/007/008, §Guardrails, §Non-Goals, Open Question 1
- Tech stack: `context/foundation/tech-stack.md`
- Supabase client pattern: `src/lib/supabase.ts:5`
- Consumer pattern to mirror: `src/pages/api/auth/signin.ts:9`, `src/middleware.ts`
- Path alias: `tsconfig.json` (`@/*` → `src/*`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema Migration

#### Automated

- [x] 1.1 Local stack up: `npx supabase start` succeeds
- [x] 1.2 `npx supabase db reset` completes without error (no seed yet)
- [x] 1.3 Tables `zones`, `missions`, `lessons`, `quiz_questions` exist
- [x] 1.4 `quiz_questions_public` view exists and omits `correct_option_id`
- [x] 1.5 `grade_mission_quiz` RPC exists and returns a JSON object
- [x] 1.6 Lint passes: `npm run lint`

#### Manual

- [x] 1.7 RLS shown enabled on all four tables in Studio
- [x] 1.8 Anon `select` on base `quiz_questions` is blocked; `quiz_questions_public` is readable

### Phase 2: Seed Content

#### Automated

- [x] 2.1 `npx supabase db reset` applies migration + seed with no error
- [x] 2.2 Row counts: zones=2, missions=2, lessons=2, quiz_questions=6
- [x] 2.3 Referential integrity: all FK references resolve
- [x] 2.4 Every `correct_option_id` matches an option `id` in its row's `options`
- [x] 2.5 Lint passes: `npm run lint`

#### Manual

- [x] 2.6 Each question is answerable from its mission's lesson body; Zone 1 reads as the start
- [x] 2.7 Content is on-brand (AI-assisted dev), no placeholder Lorem

### Phase 3: Types + Query Module + Verification

#### Automated

- [x] 3.1 `npm run db:types` writes `src/db/database.types.ts` with all four tables
- [x] 3.2 Type check passes: `npx astro check` (or `npm run build`) clean for `src/lib/content.ts`
- [x] 3.3 Lint passes: `npm run lint`
- [x] 3.4 Verification: anon read returns seeded content without `correct_option_id`; `gradeQuiz` returns `passed: true` (correct set) / `passed: false` (wrong set)

#### Manual

- [x] 3.5 `src/lib/content.ts` matches `@/lib` conventions (client passed in, path alias, no client-side secret)
- [x] 3.6 Answer key confirmed absent from every client-reachable payload (guardrail satisfied)
