# Seeded Content Model (F-01) — Plan Brief

> Full plan: `context/changes/seed-content-model/plan.md`

## What & Why

Define and seed a **read-only** content data model — zones → missions → lessons → quiz questions — so the guest core loop (S-01) can render real content instead of placeholders. Nothing user-facing can exist until this content contract does; it also becomes the shared reference that S-02's progression records and S-03's XP attach to by mission.

## Starting Point

The 10x Astro Starter is bootstrapped with a **virgin Supabase setup**: a `createClient` SSR factory (`src/lib/supabase.ts`), working email/password auth, and route-protecting middleware — but zero tables, no `supabase/migrations/`, no `seed.sql`, and no generated DB types. `config.toml` already points its seed mechanism at `./seed.sql` (which doesn't exist yet).

## Desired End State

`npx supabase db reset` builds four content tables with RLS, seeded with two ordered zones (one mission + lesson + 3 quiz questions each) on the AI-assisted-dev subject. A guest (anon key) can read all content **except the quiz answer key**, which stays in the database behind a view and a server-side grading RPC. The app has generated types and a typed `src/lib/content.ts` module ready for S-01 to consume.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Slice scope | Content model + seed only; no progression/XP tables | Roadmap F-01 mandates a minimal enabler; progression arrives with S-02/S-03. | Roadmap |
| Seed subject | 10xLearn's own domain (AI-assisted dev) | Dogfoods the product and gives real, vettable quiz content for demos. | Plan |
| Quiz schema | Options as JSONB on the question row + isolated `correct_option_id` column | One-table atomic reads; the answer key sits in a column the public view can omit. | Plan |
| Access / answer-key | RLS on, public content read; base quiz table locked, key hidden via a view + `SECURITY DEFINER` grading RPC | Guest can read content (FR-001) while the answer key never ships to the browser (guardrail). | Plan |
| Seed volume | 2 zones × 1 mission × 3 questions | The exact minimum to demonstrate one real unlock transition for S-01. | Plan |
| Code contract | Generated `database.types.ts` + typed `src/lib/content.ts` query/grade module | Hands S-01 a ready, typed, verified read path instead of raw SQL. | Plan |

## Scope

**In scope:** one schema migration (tables + RLS + public view + grading RPC); `supabase/seed.sql`; generated DB types; `src/lib/content.ts`; local read-path verification.

**Out of scope:** progression/persistence/XP tables; any UI, pages, or API routes; user-scoped RLS; in-app authoring; anti-cheat/brute-force hardening; remote/prod DB push.

## Architecture / Approach

`zones (1→N) missions (1→N) quiz_questions`, plus `lessons` as a child of `missions`. RLS is on for all four; `zones`/`missions`/`lessons` get a public `anon`/`authenticated` SELECT policy. `quiz_questions` gets **no** client policy — instead a `quiz_questions_public` view (running as owner, so it bypasses RLS) exposes every column *except* `correct_option_id`, and a `grade_mission_quiz` `SECURITY DEFINER` RPC grades submissions server-side. `src/lib/content.ts` reads via the view and grades via the RPC, all typed off generated `database.types.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema migration | Tables + RLS + public view + grading RPC | Postgres view `security_invoker` default — get it wrong and the answer key leaks or content is unreadable |
| 2. Seed content | 2 zones, 2 missions, 2 lessons, 6 questions (AI-dev subject) | Questions not genuinely answerable from the lesson (integrity) |
| 3. Types + query module + verify | `database.types.ts`, `src/lib/content.ts`, proven read path | Answer key accidentally reachable via a client payload |

**Prerequisites:** Docker running; `npx supabase start` (local stack); no upstream slices.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- **Over-modeling** (roadmap's named risk) — mitigated by seeding only Zone 1–2 needs and adding no columns beyond what renders.
- **View security default is a footgun** — the plan pins the exact behavior (view runs as owner, no `security_invoker`, base table has no client policy); a wrong toggle here silently breaks the guardrail. Verify explicitly in Phase 1/3.
- **This is not brute-force resistance** — it only closes the "answer is in the payload" hole; 3-question integrity hardening remains a v2 concern (PRD Open Question 1).

## Success Criteria (Summary)

- `npx supabase db reset` yields two playable zones with real content and correct row counts.
- A guest can read all content but the correct answer never appears in any client-reachable payload.
- `src/lib/content.ts` type-checks and its `getZones/getMission/getQuizQuestions/gradeQuiz` helpers return correct results against the seed — S-01 can build directly on them.
