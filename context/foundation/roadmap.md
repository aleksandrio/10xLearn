---
project: 10xLearn
version: 1
status: draft
created: 2026-07-27
updated: 2026-07-27
prd_version: 1
main_goal: market-feedback
top_blocker: none
---

# Roadmap: 10xLearn

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

10xLearn fuses a real curriculum with a game engagement mechanic to fix passive, drop-off-prone self-directed learning. A learner moves across a world map of locked/unlocked zones; each zone is a mission — a short lesson followed by a 3-question quiz — and the next zone only opens by passing. That gated progression is the product's distinguishing trait: the one thing that, if removed, would make 10xLearn indistinguishable from a plain list of lessons is that access is *earned* through demonstrated knowledge, never granted freely.

## North star

**S-01: guest-core-loop** — a guest lands on the map, enters Zone 1, reads the lesson, passes the 3-question quiz, and watches Zone 2 unlock — all in one session, no login. This is the validation milestone: if this loop creates the pull to continue, the product's core hypothesis holds; if it doesn't, nothing downstream matters.

> "North star" here means the smallest end-to-end, user-visible flow whose successful delivery would prove the core product hypothesis — placed as early as its prerequisites allow because everything else only matters if this works.

## At a glance

| ID    | Change ID                    | Outcome (user can …)                                          | Prerequisites | PRD refs                                  | Status   |
| ----- | ---------------------------- | ------------------------------------------------------------- | ------------- | ----------------------------------------- | -------- |
| F-01  | seed-content-model           | (foundation) seeded, read-only zone/mission/lesson/quiz content | —             | FR-004, FR-007, FR-008                    | done     |
| S-01  | guest-core-loop              | play the full loop as a guest and see the next zone unlock    | F-01          | US-01, FR-001, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009 | done     |
| S-02  | persist-progress-with-signup | sign up (email/pw or OAuth) so progress survives and resumes  | S-01          | US-01, FR-001, FR-002, FR-003             | proposed |
| S-03  | xp-across-sessions           | earn XP that accumulates and persists across sessions         | S-02          | FR-010                                    | proposed |
| S-04  | accessible-core-loop         | complete the whole loop keyboard-only or with a screen reader | S-01          | US-01, NFR (accessibility)                | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                    | Note                                                                    |
| ------ | ---------------------- | ------------------------ | ----------------------------------------------------------------------- |
| A      | Content & core loop    | `F-01` → `S-01`          | The north-star chain — proves the engagement mechanic. Build first.     |
| B      | Account & persistence  | `S-02` → `S-03`          | Joins Stream A at `S-01`; adds the persistence guardrail, then XP.       |
| C      | Accessibility          | `S-04`                   | Joins Stream A at `S-01`; hardens the loop for keyboard/screen-reader, parallel with Stream B. |

## Baseline

What's already in place in the codebase as of `2026-07-27` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro + React 19 + Tailwind wired (`astro.config.mjs`); auth pages (`src/pages/auth/*`) and a protected dashboard authored; starter welcome page still present. No map/mission/quiz/XP UI yet.
- **Backend / API:** partial — `output: "server"`; only three auth endpoints (`src/pages/api/auth/{signin,signup,signout}.ts`). No domain endpoints.
- **Data:** absent — Supabase client factory only (`src/lib/supabase.ts`); `supabase/config.toml` has empty `schema_paths`; zero tables, migrations, seeds, or queries.
- **Auth:** present — Supabase email+password sign-in/up/out wired; middleware protects `/dashboard` and redirects to `/auth/signin` (`src/middleware.ts:18-22`). OAuth (FR-002) and the guest→signup flow (FR-001) are NOT yet wired.
- **Deploy / infra:** present — Cloudflare adapter + `wrangler.jsonc` + GitHub Actions CI (`.github/workflows/ci.yml`).
- **Observability:** partial — Cloudflare native observability enabled (`wrangler.jsonc`); no app-level logging / Sentry / OTel.

## Foundations

### F-01: Seeded content model

- **Outcome:** (foundation) a read-only content data model — zones, missions, lessons, and quiz questions — is defined and seeded, so the loop renders real content instead of placeholders.
- **Change ID:** seed-content-model
- **PRD refs:** FR-004, FR-007, FR-008 (the map, lesson, and quiz all read this content); Non-Goals §"In-app content authoring" (content is seeded outside the app, so this is data-only, no authoring UI).
- **Unlocks:** S-01 (the guest core loop needs seeded zones/lessons/quizzes to render); also the shared content contract that S-02's progression records and S-03's XP reference by mission.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which subject/zones ship as the first seed content? — Owner: user. Block: no (a placeholder seed unblocks S-01; real content can swap in later).
- **Risk:** Sequenced first because nothing user-facing can render without content. Kept deliberately minimal — read-only content schema + seed only, NO progression/persistence/XP tables (those arrive with S-02/S-03) — so it stays an enabler, not a data-layer build-out. Risk: over-modeling the content schema now; mitigated by seeding only what Zone 1–2 need to prove the loop.
- **Status:** done

## Slices

### S-01: Guest core loop

- **Outcome:** a guest can land on the world map with Zone 1 unlocked and others locked, enter Zone 1, read the lesson, take the 3-question quiz, get a pass/fail result, and on a pass see Zone 2 unlock visibly — all in a single session, no account.
- **Change ID:** guest-core-loop
- **PRD refs:** US-01, FR-001 (guest-play half), FR-004, FR-005, FR-006, FR-007, FR-008, FR-009.
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How is guest, in-session unlock state held before there's an account? — Owner: team. Block: no (an implementation choice for `/10x-plan`; does not gate sequencing).
- **Risk:** This is the north star and covers most must-have FRs in one slice — justified because the PRD centers on a single user-visible workflow (Success Criteria treats the loop as atomic: "If this loop works, the product works"). Persistence, accounts, XP, and accessibility are split into separate comparable slices so this one stays the happy-path tracer bullet. Watch the ~800 ms p95 NFR for quiz submit / unlock / map nav — trivial at <1 qps but the interactions must feel immediate. If `/10x-plan` finds this too broad, split by user-visible outcome (map render vs. mission-play vs. unlock), never by layer.
- **Status:** proposed

### S-02: Persist progress with sign-up

- **Outcome:** after the guest loop, a learner can sign up (email + password — already scaffolded — or third-party OAuth) and their unlock and quiz result are saved; on returning they log in and resume exactly where they left off, with nothing reset.
- **Change ID:** persist-progress-with-signup
- **PRD refs:** US-01 (the "survives across sessions" half), FR-001 (sign-up half), FR-002, FR-003.
- **Prerequisites:** S-01
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Which third-party OAuth provider(s) ship first (FR-002 names OAuth generically)? — Owner: user. Block: no (email/password already covers the must-have; OAuth can follow).
- **Risk:** Delivers the persistence guardrail (the secondary success criterion) and closes US-01. Sequenced after S-01 because there is no progress to persist until the loop exists. Builds on the present Supabase auth scaffold (baseline) rather than re-scaffolding it; introduces the progression persistence schema here — the first slice that actually needs it (progressive disclosure) — rather than pre-building it in F-01. Risk: the guest→account state handoff (carrying an in-session unlock into a new account) is the fiddly part; call it out in the plan.
- **Status:** proposed

### S-03: XP across sessions

- **Outcome:** a learner earns XP for completing missions and sees a visible score that accumulates and persists across sessions.
- **Change ID:** xp-across-sessions
- **PRD refs:** FR-010 (nice-to-have).
- **Prerequisites:** S-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Reinforces the loop cheaply and rides on progress data that already persists after S-02. Depends on S-02 because "across sessions" requires persistence. Lowest priority of the MVP slices (nice-to-have); safe to defer if the 3-week window tightens, since it doesn't gate the core loop or the guardrail.
- **Status:** proposed

### S-04: Accessible core loop

- **Outcome:** a learner using only a keyboard, or only a screen reader, can complete the full core loop — guest play, lesson, quiz, and unlock — with all controls keyboard-operable and content screen-reader-labelled for the primary flow.
- **Change ID:** accessible-core-loop
- **PRD refs:** US-01 (this slice makes US-01's core-loop flow completable non-visually), NFR §Accessibility.
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The accessibility NFR gates launch, so this is not optional — but it's carved out as its own slice so S-01 can ship the happy path fast for validation, then be hardened and independently verified. Ideally `/10x-plan` for S-01 builds accessibly from the start and this slice becomes a verification+gap-closing pass rather than a retrofit. Parallel with the persistence stream — it touches the loop UI, not the account/data work.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                | Ready for `/10x-plan` | Notes                                              |
| ---------- | ---------------------------- | ---------------------------------------------------- | --------------------- | -------------------------------------------------- |
| F-01       | seed-content-model           | Define and seed zone/mission/lesson/quiz content     | yes                   | Minimal read-only content model; unblocks S-01     |
| S-01       | guest-core-loop              | Guest can complete the map→lesson→quiz→unlock loop    | no                    | Ready once F-01 is done — this is the north star   |
| S-02       | persist-progress-with-signup | Sign up (email/pw or OAuth) and persist/resume progress | no                 | Ready once S-01 is done                            |
| S-03       | xp-across-sessions           | Earn XP that accumulates and persists                | no                    | Ready once S-02 is done; nice-to-have              |
| S-04       | accessible-core-loop         | Keyboard + screen-reader path through the core loop  | no                    | Ready once S-01 is done; parallel with S-02/S-03   |

## Open Roadmap Questions

1. **Quiz integrity / anti-AI-passthrough** — 3-question quizzes are easy to brute-force or feed to an AI; v2 should explore scenario/application questions requiring lesson-specific recall. Owner: user. Block: none (v2; Non-Goal for MVP).
2. **Skip-ahead / test-out path** — linear unlock forces learners through material they may already know; a "test out by passing the quiz" path is a v2 candidate. Owner: user. Block: none (v2).
3. **Leaderboard / social** — cut from MVP; revisit once there's a multi-user base and social design (meaningful at ~100× scale). Owner: user. Block: none (v2; Non-Goal for MVP).

## Parked

- **In-app content authoring** — Why parked: PRD §Non-Goals — content is seeded outside the app; an authoring UI would dwarf the core loop.
- **Mobile-optimized experience** — Why parked: PRD §Non-Goals — desktop-first for v1; accessibility was prioritized over mobile responsiveness.
- **Anti-cheat / AI-passthrough prevention** — Why parked: PRD §Non-Goals — the unlimited-retry 3-question gate is knowingly brute-forceable; hardening is a v2 concern (see Open Roadmap Question 1).
- **Leaderboard / social features** — Why parked: PRD §Non-Goals — needs a multi-user base and social design a small-scale MVP doesn't warrant (see Open Roadmap Question 3).

## Done

(Empty on first generation. `/10x-archive` appends here — and flips the item's `Status` to `done` — when a change whose `Change ID` matches a roadmap item is archived.)

- **F-01: (foundation) a read-only content data model — zones, missions, lessons, and quiz questions — is defined and seeded, so the loop renders real content instead of placeholders.** — Archived 2026-07-27 → `context/archive/2026-07-27-seed-content-model/`. Lesson: —.
