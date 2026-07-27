---
project: 10xLearn
version: 1
status: draft
created: 2026-06-05
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: "<1"
  data_volume: "<1GB"
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# 10xLearn — Product Requirements Document

## Vision & Problem Statement

Traditional learning is passive and broken. Self-directed learners open a course or tutorial, hit a concept that requires effort, and either drop off or hand the thinking to an AI — moving on with the appearance of progress but zero retention. There is no active feedback loop, no consequence for skipping, and no path to knowing what to engage with next. The rise of AI chat tools has made this worse: learners get instant answers without understanding them, paste them as homework, and walk away with nothing.

The insight: most edtech is either a game with no real content, or a course with no engagement mechanic — nobody has fused the two well. 10xLearn closes three compounding gaps at once: the broken learning loop (no active practice, no feedback, no consequence for passive scrolling), the missing capability (no tool fuses a real curriculum with a genuine game engagement mechanic), and decision paralysis (learners don't know what to tackle next — a mission/unlock structure removes that ambiguity). AI shortcuts have recently raised the stakes of leaving this unsolved.

## User & Persona

**Primary persona — the self-directed learner.** Individuals across many contexts trying to acquire a new skill, of any age or background, who have access to content but lack the structure and engagement mechanics that make them follow through. They are individual learners, not institutional users.

- **Role**: learner (individual, not institutional-primary)
- **Moment they reach for the product**: they open a course or tutorial, hit something that requires effort, and need a structure that pulls them through instead of letting them drop off or shortcut to an AI
- **Cost today**: skills that look acquired but weren't; passive homework passed as their own work; zero durable knowledge built

## Success Criteria

### Primary
The core game loop works end-to-end:
1. User lands on a world map — one zone unlocked, others locked
2. Enters the unlocked zone → starts a mission
3. Reads a short lesson
4. Takes a 3-question quiz and passes
5. Zone 2 unlocks visibly on the map
6. Learner feels the pull to continue

If this loop works, the product works.

### Secondary
- Learner earns XP for completing missions; a visible score accumulates across sessions.

### Guardrails
- **Progress persistence**: unlocks, quiz results, and XP must survive a browser close and session restart — nothing resets on return.
- **No passive passthrough on quizzes**: the quiz mechanic must require the learner to engage with the lesson content, not merely relay an externally-sourced answer. (MVP-level integrity; deeper hardening is a documented Open Question.)

## User Stories

### US-01: Complete the first mission and unlock a zone

- **Given** a learner on the world map with only Zone 1 unlocked
- **When** they enter Zone 1, read the lesson, take the 3-question quiz, and answer all questions correctly
- **Then** the system records the pass, awards XP, and unlocks Zone 2 visibly on the map — and the unlock persists across sessions

#### Acceptance Criteria
- A pass requires all 3 quiz questions correct; anything less is a fail and Zone 2 stays locked.
- On a fail, the learner can retake the quiz immediately, with no attempt limit.
- The unlock, quiz result, and awarded XP survive a browser close and session restart.

## Functional Requirements

### Account
- FR-001: Learner can play the first zone (Zone 1) without an account, then sign up to save progress. Priority: must-have
  > Socratic: Counter-argument considered: "a signup wall before any value kills first-session conversion." Resolution: defer the auth wall — the learner experiences the core loop in Zone 1 as a guest, then signs up to persist. Reduces bounce while preserving the persistence guardrail.
- FR-002: Learner can sign up with email + password or third-party OAuth to persist progress beyond Zone 1. Priority: must-have
  > Socratic: see FR-001 — signup is gated behind first value, not in front of it.
- FR-003: Learner can log in and resume their persisted progress. Priority: must-have

### Map & progression
- FR-004: Learner can view a world map showing which zones are locked and unlocked. Priority: must-have
  > Socratic: Counter-argument considered: "a map is decorative chrome over a simple list." Resolution: kept — the locked/unlocked spatial metaphor IS the engagement mechanic; it makes progress visible and creates the pull to continue.
- FR-005: Learner can enter an unlocked zone and start a mission. Priority: must-have
  > Socratic: No counter-argument; stands as written — this is the entry to the core loop.
- FR-006: System unlocks the next zone when the learner passes a mission's quiz. Priority: must-have
  > Socratic: Counter-argument considered: "strict linear unlock forces learners who know the material to grind." Resolution: kept linear for MVP — simplest mechanic to ship and validate; a 'test out' / skip-ahead path is a documented v2 candidate.

### Mission & quiz
- FR-007: Learner can read a short lesson within a mission. Priority: must-have
  > Socratic: No counter-argument; stands as written — the lesson is the content the quiz tests.
- FR-008: Learner can take a 3-question quiz and submit answers. Priority: must-have
  > Socratic: Counter-argument considered: "3 questions are easy to brute-force, pass by luck, or feed to an AI — undermining the no-passive-learning insight." Resolution: accepted for MVP to prove the loop; question-depth and anti-AI hardening (scenario/application questions over definitions) are a documented v2 concern. See Open Questions.
- FR-009: Learner receives a pass/fail result after submitting a quiz. Priority: must-have
  > Socratic: No counter-argument; stands as written — the result drives the unlock.

### Engagement
- FR-010: Learner can see their accumulated XP score across sessions. Priority: nice-to-have
  > Socratic: Counter-argument considered: "gamification-extras distract from proving the core loop." Resolution: kept — XP reinforces the loop cheaply and persists with existing progress data.

> Note: A leaderboard capability (formerly FR-011) was **cut** during shaping — it needs a multi-user base and social design beyond a small-scale MVP. Recorded in Non-Goals and Open Questions.

## Non-Functional Requirements

- **Snappy interactions**: user-perceived response under ~800 ms (p95) for quiz submission, zone unlock, and map navigation — the engagement loop must feel immediate, never laggy.
- **Accessibility**: a learner using only a keyboard, or only a screen reader, can complete the full core loop (guest play, lesson, quiz, unlock). Controls are keyboard-operable and content is screen-reader-labelled for the primary flow.

## Business Logic

**Core rule (one sentence)**: A learner unlocks the next zone only by passing the current zone's quiz — access is earned through demonstrated knowledge, never granted freely.

This is the gating decision the application makes for the learner, and it is what separates the product from a generic list of lessons. The learner does not choose what to access; the app decides, based on demonstrated performance.

- **Inputs the rule consumes**: the learner's answers to the current mission's 3-question quiz, and their current progression state (which zones are already unlocked).
- **Pass condition**: all 3 questions correct — a strict gate; anything less is a fail. This maximizes the signal that the learner actually engaged with the lesson.
- **On pass**: the next zone unlocks, XP is awarded, and the new state persists.
- **On fail**: the learner may retake the quiz immediately, with no attempt limit; the product encourages re-reading the lesson before retrying. (MVP tradeoff: unlimited retry is the simplest path but invites brute-forcing — flagged in Open Questions for v2 hardening.)
- **How the user encounters it**: as the locked/unlocked state of zones on the world map. Passing visibly opens the next zone; failing keeps it shut until the learner demonstrates the knowledge.

## Access Control

- **Auth model**: email + password or third-party OAuth. Accounts are required to persist progress, unlocks, and earned state across sessions and devices — with one deliberate exception: Zone 1 is playable as a guest before sign-up (see FR-001), after which an account is required to save and continue.
- **Role model**: flat. All authenticated users are learners. No in-app content-authoring or admin roles in the MVP; admin work (content management, user oversight) happens outside the product for now.
- **Rationale**: a flat learner account is the smallest access model that still makes the MVP useful; role expansion belongs to a later iteration once the core loop is validated.

## Non-Goals

- **In-app content authoring**: no UI for creating missions, lessons, or quizzes in v1. Content is seeded outside the app. Authoring is a major surface that would dwarf the core loop if built now.
- **Mobile-optimized experience**: desktop-first. Mobile browsers may render but are not a v1 target — accessibility was prioritized over mobile responsiveness for the MVP.
- **Anti-cheat / AI-passthrough prevention**: no quiz-integrity hardening in v1. The unlimited-retry, 3-question gate is knowingly brute-forceable; hardening is a v2 concern.
- **Leaderboard / social features**: cut during shaping — needs a multi-user base and social design that a small-scale MVP doesn't warrant yet.

## Open Questions

1. **Quiz integrity / anti-AI-passthrough** — 3-question quizzes are easy to brute-force or feed to an AI. v2 should explore scenario/application questions that require lesson-specific recall. Owner: user. (From FR-008 Socratic round.)
2. **Skip-ahead / test-out path** — linear unlock forces learners through material they may already know. A 'test out by passing the quiz' path is a v2 candidate. Owner: user. (From FR-006 Socratic round.)
3. **Leaderboard** — cut from MVP; revisit once there's a multi-user base and social design. At ~100× scale this becomes a meaningful engagement lever. Owner: user. (From shaping Socratic round + scale probe.)

> Resolved 2026-07-27: Scale ballparks captured directly — `qps: <1` (peak; small after-hours MVP) and `data_volume: <1GB` (structured records only, no media). Recorded in `target_scale` frontmatter.
