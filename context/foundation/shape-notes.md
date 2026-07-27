---
project: 10xLearn
context_type: greenfield
updated: 2026-06-05
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  after_hours_only: true
  hard_deadline: null
tech_preferences:
  language_family: null
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 10
  quality_check_status: accepted
---

> Seed idea: "a platform web game that will engage users to learn. Simple missions lessons and quizes to unlock new areas."

## Vision & Problem Statement

Traditional learning is passive and broken. Learners watch videos but don't retain anything — there is no active feedback loop, no consequence for skipping, and no path to knowing what to engage with next. The rise of AI chat tools (ChatGPT et al.) has made this worse: learners get instant answers without understanding them, paste them as homework, and walk away with nothing.

The product closes three compounding gaps simultaneously:
- **Workflow friction**: the learning loop is broken — no active practice, no feedback, no consequence for passive scrolling.
- **Missing capability**: no tool fuses a real curriculum with a genuine game engagement mechanic.
- **Decision paralysis**: learners don't know what to tackle next; a mission/unlock structure removes that ambiguity.

**Insight**: most edtech is either a game with no real content, or a course with no engagement mechanic. Nobody has fused the two well — and AI shortcuts have recently made the stakes of NOT solving this much higher.

## User & Persona

**Primary persona**: individuals across many contexts who are trying to acquire a new skill — self-directed learners of any age or background who have access to content but lack the structure and engagement mechanics that make them follow through.

- **Role**: learner (individual, not institutional-primary)
- **Moment of pain**: they open a course or tutorial, hit something that requires effort, and either drop off or hand the thinking to an AI — moving on with the appearance of progress but zero retention
- **Cost today**: skills that look acquired but weren't; passive homework passed as their own work; zero durable knowledge built

## Access Control

- **Auth model**: email + password or OAuth (e.g. Google). Accounts are required — progress, unlocks, streaks, and earned state must persist across sessions and devices.
- **Role model**: flat. All authenticated users are learners. No in-app content-authoring or admin roles in the MVP. Admin work (content management, user oversight) happens outside the product for now.
- **Socratic note**: "What's the smallest access model that would still make the MVP useful?" — a flat learner account is sufficient; role expansion belongs to a later iteration once the core loop is validated.

## Success Criteria

### Primary
The core game loop works end-to-end:
1. User signs up and lands on a world map — one zone unlocked, others locked
2. Enters the unlocked zone → starts a mission
3. Reads a short lesson
4. Takes a 3-question quiz and passes
5. Zone 2 unlocks visibly on the map
6. Learner feels the pull to continue

If this loop works, the product works.

### Secondary
- Learner earns XP for completing missions; a visible score accumulates across sessions
- A leaderboard shows how learners rank against others (read-only, no social features required)

### Guardrails
- **Progress persistence**: unlocks, quiz results, and XP must survive a browser close and session restart — nothing resets on return
- **No AI passthrough on quizzes** (implicit): the quiz mechanic must require the learner to engage with the lesson content, not just relay an AI answer

## Functional Requirements

### Account
- FR-001: Learner can play the first zone (Zone 1) without an account, then sign up to save progress. Priority: must-have
  > Socrates: Counter-argument considered: "a signup wall before any value kills first-session conversion." Resolution: defer the auth wall — the learner experiences the core loop in Zone 1 as a guest, then signs up to persist. Reduces bounce while preserving the persistence guardrail.
- FR-002: Learner can sign up with email + password or OAuth to persist progress beyond Zone 1. Priority: must-have
  > Socrates: see FR-001 — signup is gated behind first value, not in front of it.
- FR-003: Learner can log in and resume their persisted progress. Priority: must-have

### Map & progression
- FR-004: Learner can view a world map showing which zones are locked and unlocked. Priority: must-have
  > Socrates: Counter-argument considered: "a map is decorative chrome over a simple list." Resolution: kept — the locked/unlocked spatial metaphor IS the engagement mechanic; it makes progress visible and creates the pull to continue.
- FR-005: Learner can enter an unlocked zone and start a mission. Priority: must-have
  > Socrates: No counter-argument; stands as written — this is the entry to the core loop.
- FR-006: System unlocks the next zone when the learner passes a mission's quiz. Priority: must-have
  > Socrates: Counter-argument considered: "strict linear unlock forces learners who know the material to grind." Resolution: kept linear for MVP — simplest mechanic to ship and validate; a 'test out' / skip-ahead path is a documented v2 candidate.

### Mission & quiz
- FR-007: Learner can read a short lesson within a mission. Priority: must-have
  > Socrates: No counter-argument; stands as written — the lesson is the content the quiz tests.
- FR-008: Learner can take a 3-question quiz and submit answers. Priority: must-have
  > Socrates: Counter-argument considered: "3 questions are easy to brute-force, pass by luck, or feed to an AI — undermining the no-passive-learning insight." Resolution: accepted for MVP to prove the loop; question-depth and anti-AI hardening (scenario/application questions over definitions) are a documented v2 concern. See Open Questions.
- FR-009: Learner receives a pass/fail result after submitting a quiz. Priority: must-have
  > Socrates: No counter-argument; stands as written — the result drives the unlock.

### Engagement
- FR-010: Learner can see their accumulated XP score across sessions. Priority: nice-to-have
  > Socrates: Counter-argument considered: "gamification-extras distract from proving the core loop." Resolution: kept — XP reinforces the loop cheaply and persists with existing progress data.
- ~~FR-011: Learner can view a leaderboard ranking learners by XP.~~ **CUT in Socrates round** — a leaderboard needs multiple concurrent users and social design; deferred to post-MVP. Recorded in Open Questions.

## User Stories

### US-01: Complete the first mission and unlock a zone
- **Given** a newly signed-up learner on the world map with only Zone 1 unlocked
- **When** they enter Zone 1, read the lesson, take the 3-question quiz, and answer enough correctly to pass
- **Then** the system records the pass, awards XP, and unlocks Zone 2 visibly on the map — and the unlock persists across sessions

## Business Logic

**Core rule (one sentence)**: A learner unlocks the next zone only by passing the current zone's quiz — access is earned through demonstrated knowledge, never granted freely.

This is the gating decision the application makes for the learner, and it is what separates the product from a generic list of lessons. The learner does not choose what to access; the app decides, based on demonstrated performance.

- **Inputs the rule consumes**: the learner's answers to the current mission's 3-question quiz, and their current progression state (which zones are already unlocked).
- **Pass condition**: all 3 questions correct. A strict gate — anything less is a fail. This maximizes the signal that the learner actually engaged with the lesson.
- **On pass**: the next zone unlocks, XP is awarded, and the new state persists.
- **On fail**: the learner may retake the quiz immediately, with no attempt limit; the app encourages re-reading the lesson before retrying. (MVP tradeoff: unlimited retry is the simplest path but invites brute-forcing — flagged in Open Questions for v2 hardening.)
- **How the user encounters it**: as the locked/unlocked state of zones on the world map. Passing visibly opens the next zone; failing keeps it shut until the learner demonstrates the knowledge.

## Non-Functional Requirements

- **Snappy interactions**: user-perceived response under ~800ms (p95) for quiz submission, zone unlock, and map navigation — the engagement loop must feel immediate, never laggy.
- **Accessibility**: a learner using only a keyboard or a screen reader can complete the full core loop (sign-up-deferred play, lesson, quiz, unlock). Target keyboard-operable controls and screen-reader-labelled content for the primary flow.

## Non-Goals

- **In-app content authoring**: no UI for creating missions, lessons, or quizzes in v1. Content is seeded outside the app. Authoring is a major surface that would dwarf the core loop if built now.
- **Mobile-optimized experience**: desktop-first. Mobile browsers may render but are not a v1 target — accessibility was prioritized over mobile responsiveness for the MVP.
- **Anti-cheat / AI-passthrough prevention**: no quiz-integrity hardening in v1. The unlimited-retry, 3-question gate is knowingly brute-forceable; hardening is a v2 concern.
- **Leaderboard / social features**: cut in the Socrates round — needs a multi-user base and social design that a small-scale MVP doesn't warrant yet.

## Open Questions

- **Quiz integrity / anti-AI-passthrough**: 3-question quizzes are easy to brute-force or feed to an AI. v2 should explore scenario/application questions that require lesson-specific recall. (From FR-008 Socrates round.)
- **Skip-ahead / test-out path**: linear unlock forces learners through material they may already know. A 'test out by passing the quiz' path is a v2 candidate. (From FR-006 Socrates round.)
- **Leaderboard**: cut from MVP; revisit once there's a multi-user base and social design. At ~100× scale this becomes a meaningful engagement lever. (From Socrates round + scale probe.)

## Quality cross-check

All six greenfield elements present — `quality_check_status: accepted`. No gaps.

- Access Control: present — email/OAuth, flat learner role, deferred auth wall
- Business Logic: present — one-sentence gating rule
- Project artifacts: present
- Timeline-cost ack: present — 3-week MVP, within budget
- Non-Goals: present — 4 entries
- Preserved behavior: n/a (greenfield)
