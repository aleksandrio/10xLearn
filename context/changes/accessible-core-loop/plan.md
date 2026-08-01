# Accessible Core Loop Implementation Plan

## Overview

Make the full core loop — world map → lesson → quiz → unlock — completable by a
keyboard-only learner and by a screen-reader user, and verify that claim by hand.

This is roadmap slice **S-04**, and it is deliberately a *verification and
gap-closing* pass rather than a retrofit: `guest-core-loop` built an accessible
baseline in from Phase 1 (`context/changes/guest-core-loop/plan.md:120,171,222`).
The work here is to turn on the automated gate that was supposed to be guarding
that baseline (and wasn't), close the specific gaps that slipped through it, and
then run the loop end-to-end non-visually.

## Current State Analysis

The baseline is real and mostly good. Semantic landmarks and headings exist,
checkpoints are real `<button>`s with composed accessible names, focus-visible
rings are applied consistently, decorative icons are `aria-hidden`, animations are
gated behind `motion-safe:`, `<html lang="en">` is set, and the quiz outcome is
already announced through an `aria-live` region.

What is missing splits into one systemic hole and a set of concrete gaps.

**The systemic hole: React has never been a11y-linted.** `eslint.config.js` wires
`eslintPluginAstro.configs["flat/jsx-a11y-recommended"]`, which scopes itself to
`**/*.astro`. Every component in the core loop is React `.tsx`
(`WorldMap.tsx`, `LessonPanel.tsx`, `QuizPanel.tsx`), so none of them are covered
— despite `guest-core-loop`'s plan asserting that lint "includes `jsx-a11y`"
(`context/changes/guest-core-loop/plan.md:251`). That false assumption is why the
gaps below were never caught.

**The concrete gaps:**

- **Focus is lost returning to the map.** `backToMap()` (`WorldMap.tsx:40`) flips
  the view; panels move focus *in* on open (`LessonPanel.tsx:19`,
  `QuizPanel.tsx:105`) but nothing moves it back out. A keyboard learner returning
  from a lesson lands at document start and re-Tabs the entire trail.
- **Focus is lost on quiz submit.** The submit button disables during grading and,
  on a pass, the whole question list is replaced by the success panel
  (`QuizPanel.tsx:183-213`). Focus falls to `<body>`. The `aria-live` region still
  speaks, so a screen-reader user hears the result — but their Tab position is gone.
- **Focus is lost on "Try again."** The button that was just activated unmounts
  (`QuizPanel.tsx:225-232`), dropping focus to `<body>` with no landing point.
- **Panel headings announce the loading placeholder, then go quiet.** The focus
  effect runs once on mount (`LessonPanel.tsx:19-21`, `QuizPanel.tsx:105-107`),
  when the heading still reads "Loading briefing…". When the real title arrives the
  focused element's text changes silently.
- **Correct/incorrect markers may not be exposed.** `aria-label` sits on a bare
  lucide `<svg>` with no `role="img"` (`QuizPanel.tsx:250,252`), which assistive
  tech is not obliged to honour — and it diverges from the `aria-hidden` +
  visible-text convention used everywhere else in the codebase.
- **Locked checkpoints are unreachable.** They carry `disabled`
  (`WorldMap.tsx:244`), removing them from tab order. A keyboard-only learner
  without a screen reader gets no signal that further zones exist ahead.
- **No skip mechanism, and the account nav is inside `<main>`.** `Layout.astro`
  renders no skip link, and `WorldMap` puts `<nav aria-label="Account">` *inside*
  its `<main>` (`WorldMap.tsx:102-151`) — so landmark navigation misreports the
  page structure and there is nothing to skip to.

### Key Discoveries

- **`jsx-a11y` strict already passes clean** on every current `.tsx` file
  (verified by dry-run against `flatConfigs.strict`, 33 rules, exit 0). Turning the
  gate on costs nothing today and buys regression protection for free — there is no
  cleanup backlog hiding behind it.
- **`eslint-plugin-jsx-a11y@6.10.2` is already in `devDependencies`** — no new
  dependency is needed.
- **`jsxA11y.flatConfigs.strict` carries no `files` key** (verified:
  `keys: [languageOptions, name, plugins, rules]`). It must be scoped explicitly.
- **No page outside the loop has a `<main>` element.** Auth pages and
  `dashboard.astro` render no landmark at all, so a `Layout`-level skip link with a
  fixed target would dangle there. The skip link must therefore be opt-in per page.
- **Test infrastructure exists but is unused for components.** `vitest` + `jsdom` +
  `@testing-library/{react,user-event,jest-dom}` are installed with a working
  `vitest.setup.ts`; only two pure-logic test files exist. Per the verification
  decision, this slice does not add component tests.
- **Prior slices recorded manual verification inline in Progress**, e.g.
  `context/archive/2026-07-31-persist-progress-with-signup/plan.md:519`. Phase 4
  follows that convention.

## Desired End State

A learner can complete the entire loop — land on the map, open Zone 1's lesson,
take its quiz, fail and retry, pass, and see the next zone lit — using only a
keyboard, and separately using only a screen reader, without ever losing their
place or encountering an unlabelled control.

Verify by: running `npm run lint` (now covering React a11y), then walking the
documented keyboard-only and screen-reader scripts in §Testing Strategy and
recording each outcome in §Progress.

## What We're NOT Doing

- **Colour contrast.** Deferred by explicit decision. The small-text tokens
  (`text-slate-500` at `text-[10px]`/`text-xs` on `bg-slate-950`) sit near the
  4.5:1 line and remain unmeasured. Phase 4 writes this down as a named, owned
  risk rather than silently dropping it.
- **Browser history / Back navigation.** `map ⇄ lesson ⇄ quiz` still never touches
  the URL (`WorldMap.tsx:31`), so Back exits the app mid-loop. Not a WCAG
  criterion, every view has an in-page "Back to map", and mapping views to URLs is
  an architecture change — deferred by decision, documented in Phase 4.
- **Auth pages and the dashboard.** `signin`/`signup`/`forgot-password`/
  `update-password`/`dashboard` are out of scope; they belong to S-02's surface.
  The signup nudge therefore still leads out of verified territory.
- **No automated a11y test infrastructure.** No axe, no Playwright, no `vitest`
  component tests. Per decision, the gate is static lint plus a human checklist.
- **Mobile / reflow / zoom.** PRD §Non-Goals is desktop-first.
- **No behaviour changes to grading, unlocking, XP, or persistence.** This slice
  touches presentation, focus, and labelling only.

## Implementation Approach

Gate first, then fix, then verify.

Phase 1 turns on the lint that should already have been running, so every
subsequent phase is edited under the guard. Phase 2 corrects the page shell
(landmarks and the skip mechanism) because it changes DOM structure that Phase 3's
focus work sits inside. Phase 3 closes the focus and labelling gaps. Phase 4 is
the actual deliverable the slice is judged on — a recorded human pass through the
loop, keyboard-only and then screen-reader-only.

## Critical Implementation Details

**Flat-config scoping is load-bearing.** `jsxA11y.flatConfigs.strict` has no
`files` key, so dropping it into the config array unscoped applies its 33 rules
*and* its `parserOptions.ecmaFeatures.jsx` to `.astro` and `.ts` files, colliding
with the dedicated Astro parser block. It must be spread with an explicit scope:

```js
{ ...jsxA11y.flatConfigs.strict, files: ["**/*.{jsx,tsx}"] }
```

**Focus restoration cannot happen inside `backToMap()`.** While a panel is
rendered, `WorldMap` returns early (`WorldMap.tsx:86-93`) — the map's checkpoint
buttons are not in the DOM at all, so their refs are null when the handler runs.
The restore has to happen in an effect that fires *after* the map re-renders and
re-registers its refs.

**One announcement channel, not two.** Moving focus into the quiz result panel
while an `aria-live` region simultaneously receives the same sentence makes screen
readers speak the outcome twice. Because Phase 3 gives the result panel focus (the
keyboard fix), the live region stops being the right mechanism: the composed
sentence should move *inside* the focused container as static `sr-only` content.
Removing an `aria-live` region during an accessibility pass reads backwards, hence
this note — the announcement is not lost, it changes carrier.

---

## Phase 1: A11y lint gate

### Overview

Extend `jsx-a11y` to React files so static accessibility regressions fail CI.
Verified to pass clean today, so this phase adds a guard and changes no behaviour.

### Changes Required:

#### 1. ESLint configuration

**File**: `eslint.config.js`

**Intent**: Cover `**/*.{jsx,tsx}` with `jsx-a11y` so the core loop's React
components are linted for accessibility — closing the hole that let this slice's
gaps ship. Use `strict` rather than `recommended`: the dry-run shows both pass
clean, so strict is free today and catches more later.

**Contract**: Add one scoped config block to the array exported by
`tseslint.config(...)`, positioned after `reactConfig` and before
`eslintPluginPrettier` (which must remain last). The existing
`flat/jsx-a11y-recommended` block for `.astro` files stays untouched. Import the
already-installed `eslint-plugin-jsx-a11y`. The block must be spread with an
explicit `files` scope — see §Critical Implementation Details for why.

### Success Criteria:

#### Automated Verification:

- Lint passes with the new gate active: `npm run lint`
- Unit tests still pass: `npm test`
- Build succeeds: `npm run build`
- Astro files are unaffected — no new warnings or parser errors from `.astro` in the lint output

#### Manual Verification:

- Deliberate-break check: temporarily introduce a jsx-a11y violation in a `.tsx` file (e.g. an `onClick` on a bare `<div>`), confirm `npm run lint` fails naming a `jsx-a11y/*` rule, then revert — proving the gate is live rather than silently scoped out

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: Landmarks and skip link

### Overview

Fix the page shell so landmark navigation reports the truth and a keyboard learner
can bypass the account nav. Structural only — no focus behaviour yet.

### Changes Required:

#### 1. Layout skip link

**File**: `src/layouts/Layout.astro`

**Intent**: Provide a bypass mechanism for the repeated account nav, opt-in per
page so it never dangles on the auth/dashboard pages that render no `<main>`.

**Contract**: Add an optional `mainId?: string` prop to the existing `Props`
interface. When it is set, render an anchor to `#{mainId}` as the **first element
inside `<body>`, before the `missingConfigs` banners** — those banners contain
links, so a skip link placed after them would not be the first focusable element.
The link is visually hidden until focused (Tailwind's `sr-only` +
`focus:not-sr-only` idiom) and must be plainly visible once focused, against the
dark shell. When `mainId` is absent, render nothing — auth and dashboard pages are
unchanged.

#### 2. Skip target and landmark structure on the map

**File**: `src/components/game/WorldMap.tsx`

**Intent**: Move the account nav out of `<main>` so `<nav>` is a sibling top-level
landmark rather than page content, and give `<main>` the shared skip target. Today
the nav lives inside `<main>`, which both misreports structure to landmark
navigation and leaves the skip link with nothing to skip.

**Contract**: The component returns a fragment: the `<nav aria-label="Account">`
(both the authenticated and guest variants) becomes a sibling *preceding*
`<main>`. `<main>` keeps `aria-labelledby="worldmap-heading"` and gains
`id="main-content"` plus `tabIndex={-1}` so it can receive programmatic focus. No
change to the nav's own markup, links, or the sign-out form.

#### 3. Skip target and accessible names on the panels

**File**: `src/components/game/LessonPanel.tsx`, `src/components/game/QuizPanel.tsx`

**Intent**: Give each panel's `<main>` the same skip target and an accessible name,
matching the map's landmark treatment so the skip link works in every view.

**Contract**: Each `<main>` gains `id="main-content"`, `tabIndex={-1}`, and
`aria-labelledby` pointing at its existing heading id (`lesson-heading` /
`quiz-heading`). Views are mutually exclusive, so exactly one `#main-content`
exists in the document at any time — an invariant the implementer must preserve.

#### 4. Skip target on the fallback state, and opt in

**File**: `src/pages/index.astro`

**Intent**: Pass the skip-link opt-in, and make sure the "world map unavailable"
fallback is a valid skip target too, so the link is not broken when Supabase is
misconfigured.

**Contract**: Pass `mainId="main-content"` to `<Layout>`. Add
`id="main-content"` and `tabindex="-1"` to the fallback `<main>` at
`src/pages/index.astro:45`. No change to the SSR data flow.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- Tab once from a fresh load of `/` — the skip link is the first focusable element and is clearly visible when focused
- Activating the skip link moves focus into `<main>`; the next Tab reaches a trail checkpoint, not an account-nav link
- A screen reader's landmark list shows `navigation` and `main` as siblings, with `main` named "Your expedition"
- The skip link works in all three views (map, lesson, quiz) and in the "world map unavailable" fallback
- Auth pages and `/dashboard` render no skip link and are otherwise unchanged

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 3: Focus and announcement behaviour

### Overview

Close the focus-loss and labelling gaps: locked checkpoints become discoverable,
focus survives every view transition, and the quiz outcome is announced exactly
once.

### Changes Required:

#### 1. Locked checkpoints become keyboard-discoverable

**File**: `src/components/game/WorldMap.tsx`

**Intent**: Let a keyboard learner Tab past locked checkpoints and hear that
further zones exist, matching what a sighted learner already sees. `disabled`
currently removes them from tab order entirely.

**Contract**: Drop the `disabled` attribute from the checkpoint button
(`WorldMap.tsx:244`); keep `aria-disabled={zone.locked}`. Activation must remain a
no-op for locked zones — no handler is attached in that case today, and that must
stay true so Enter and Space do nothing. The accessible name already carries
`(locked)` and the visual locked treatment is unchanged.

#### 2. Focus restoration on return to the map

**File**: `src/components/game/WorldMap.tsx`

**Intent**: Return focus to the checkpoint button the learner opened, so leaving a
panel does not cost them their place on a long trail.

**Contract**: Register each checkpoint button in a ref keyed by
`` `${zone.slug}:${checkpoint.type}` `` via a callback ref. `openLesson` /
`openQuiz` record that key as the pending restore target. An effect that fires when
`view` returns to `"map"` focuses the recorded button and clears the target. The
restore must live in an effect, not in `backToMap()` — see §Critical Implementation
Details. If the recorded button is missing, fall back to focusing `<main>` rather
than leaving focus on `<body>`.

#### 3. Panel headings re-announce when content lands

**File**: `src/components/game/LessonPanel.tsx`, `src/components/game/QuizPanel.tsx`

**Intent**: A screen-reader user currently hears "Loading briefing…" and then
nothing, because the focused heading's text is swapped silently. Re-announce once
the real title (or the error) arrives.

**Contract**: The existing focus effect re-runs on `status` change rather than only
on mount, so the heading is re-focused on the `loading → ready | error`
transition. `status` changes at most once per panel mount, so this cannot fight a
user who has moved focus later in the session.

#### 4. Quiz result receives focus, announced once

**File**: `src/components/game/QuizPanel.tsx`

**Intent**: Land the learner on the outcome after grading instead of dropping focus
to `<body>`, and keep the announcement to a single utterance.

**Contract**: Both outcome containers (the pass panel at `QuizPanel.tsx:183-211`
and the fail panel at `:215-233`) take a shared ref and `tabIndex={-1}`, and are
focused by an effect when `phase` becomes `"result"`. The composed sentence from
the existing `announce(result)` helper moves *inside* that container as static
`sr-only` content; the standalone `aria-live` region (`:179-181`) and the fail
panel's `role="status"` (`:216`) are both removed, so the outcome is spoken once
on focus rather than twice. `announce()` itself keeps its current wording and the
visible outcome UI is unchanged.

#### 5. "Try again" returns focus to the questions

**File**: `src/components/game/QuizPanel.tsx`

**Intent**: The activated button unmounts, so focus must be placed deliberately on
the retry path.

**Contract**: `tryAgain()` sets an intent flag; an effect focuses the first
question's first radio input when `phase` returns to `"answering"` **from**
`"result"`. It must not fire on initial mount, where the heading owns focus.

#### 6. Correctness markers get text alternatives

**File**: `src/components/game/QuizPanel.tsx`

**Intent**: Make per-question correctness reliably available to assistive tech, and
match the codebase's existing decorative-icon convention.

**Contract**: The `CheckCircle2` / `XCircle` icons (`QuizPanel.tsx:250,252`) become
`aria-hidden` and are paired with an adjacent `sr-only` span reading "Correct" /
"Incorrect", replacing the `aria-label` on the bare `<svg>`. The marker stays
inside the question's `<legend>` so it is read as part of the question.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Build succeeds: `npm run build`

#### Manual Verification:

- Tab reaches locked checkpoints; they announce as locked/dimmed, and Enter and Space do nothing
- Opening a lesson then returning to the map restores focus to the exact checkpoint that was activated — confirmed for a lesson checkpoint and a quiz checkpoint, in more than one zone
- Opening a panel announces the real lesson/quiz title once loaded, not just "Loading…"
- Submitting the quiz moves focus onto the outcome panel; the score, banked XP, record status, and gate result are spoken **once**, not twice
- "Try again" places focus on the first question's first option
- Per-question correct/incorrect status is spoken when reading each graded question
- A forced fetch failure (offline/throttled) still announces the error and leaves focus somewhere usable

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 4: Manual verification pass

### Overview

The deliverable this slice is judged on: a recorded human walk of the full loop,
keyboard-only and then screen-reader-only, plus written ownership for the two
deferred risks.

### Changes Required:

#### 1. Recorded verification outcomes

**File**: `context/changes/accessible-core-loop/plan.md`

**Intent**: Record the result of each manual script directly in §Progress, matching
the convention prior slices used
(`context/archive/2026-07-31-persist-progress-with-signup/plan.md:519`), so the
accessibility claim is evidenced rather than asserted.

**Contract**: Each Phase 4 Progress row is checked off with a short outcome note
and the date. Any gap found that is not fixed in this slice is written up in
`change.md` §Notes instead of being silently closed.

#### 2. Deferred-risk record

**File**: `context/changes/accessible-core-loop/change.md`

**Intent**: Give the two deferred items an owner and a rationale so they are
findable later rather than lost with the planning conversation.

**Contract**: §Notes records (a) unmeasured small-text contrast — which tokens,
which components, why deferred; and (b) view switching without history, so Back
exits the loop. Both flagged as launch-gating-NFR follow-ups, not closed items.

### Success Criteria:

#### Automated Verification:

- Full suite green from a clean checkout: `npm run lint`, `npm test`, `npm run build`

#### Manual Verification:

- **Keyboard-only, guest:** the full loop — land on `/`, skip link, open Zone 1 lesson, back to map, open quiz, fail once, try again, pass, return to map and see Zone 2 lit — completed without touching a pointer, with focus visible at every step and never lost to `<body>`
- **Keyboard-only, authenticated:** same loop signed in, including the account nav and sign-out
- **Screen reader, full loop:** completed non-visually; zone lock state, checkpoint types, lesson body, question prompts, per-question correctness, the outcome, and the unlock are all conveyed
- **Announcement hygiene:** no double-speaking of the outcome, and no silent state changes at any transition
- **Reduced motion:** with `prefers-reduced-motion: reduce`, no animation runs and no information is lost (closes the two unchecked rows left in `context/archive/2026-07-31-xp-across-sessions/plan.md:452,455`)
- **Guest nudge:** the post-unlock nudge is reachable, labelled, and dismissible by keyboard, and dismissing it does not strand focus
- Outcomes for every row above are written into §Progress, and deferred items into `change.md` §Notes

**Implementation Note**: This phase is the human verification gate. Nothing is
marked done on the strength of automated checks alone.

---

## Testing Strategy

No new automated tests are added — the verification standard for this slice is
static lint plus a human checklist. `npm run lint` (now including `jsx-a11y` on
React), `npm test`, and `npm run build` remain the automated gate, all three
already wired into CI (`.github/workflows/ci.yml`).

### Keyboard-only script

1. Load `/` fresh. Press Tab once — the skip link must be first and visible.
2. Activate it; Tab again — the next stop is a trail checkpoint, not a nav link.
3. Tab through the trail. Confirm locked checkpoints are reachable and announce as
   locked; confirm Enter and Space on a locked one do nothing.
4. Activate Zone 1's lesson checkpoint. Focus lands in the panel; the real title is
   the heading. Read to the end, activate "Back to map".
5. **Focus is back on the lesson checkpoint you activated.** Tab once — the quiz
   checkpoint.
6. Activate the quiz. Answer at least one question wrong, submit. Focus lands on
   the fail panel. Activate "Try again" — focus lands on the first option.
7. Answer all correctly, submit. Focus lands on the success panel. Activate "Back
   to the map" — focus is on the quiz checkpoint, and Zone 2 is lit.
8. Repeat 4–7 signed in, then sign out by keyboard.

### Screen-reader script

Run the same eight steps with the screen reader driving, checking at each step
that: landmark navigation lists `navigation` + `main` as siblings; each zone's
lock state and each checkpoint's type are in its accessible name; the quiz outcome
(score, banked XP, record status, gate result) is spoken exactly once on grading;
graded questions carry "Correct"/"Incorrect"; and the guest nudge is announced and
dismissible.

### Edge cases to exercise manually

- Throttle or block `/api/game/lesson` and `/api/game/quiz` → the error is
  announced and focus stays usable.
- Block `/api/game/grade` → the submit error is announced and focus returns to a
  usable control.
- `prefers-reduced-motion: reduce` → no animation, no lost information.
- Misconfigure Supabase → the "world map unavailable" fallback is still a valid
  skip target.

## Performance Considerations

None material. The changes are structural markup, ref registration, and focus
effects; no new network calls, no new renders on the hot path. The ~800 ms p95 NFR
for quiz submit / unlock / map nav is untouched — grading and unlock logic are not
modified.

## Migration Notes

Not applicable: no schema, data, or API changes. The only cross-cutting change is
the new lint scope, which is verified to pass clean against the current tree.

## References

- Roadmap slice S-04: `context/foundation/roadmap.md:116-126`
- Accessibility NFR: `context/foundation/prd.md:101`
- Baseline built by the north-star slice: `context/changes/guest-core-loop/plan.md:120,171,222`
- The false lint claim this slice corrects: `context/changes/guest-core-loop/plan.md:251`
- Manual-verification recording convention: `context/archive/2026-07-31-persist-progress-with-signup/plan.md:519`
- Unchecked reduced-motion rows inherited from S-03: `context/archive/2026-07-31-xp-across-sessions/plan.md:452,455`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: A11y lint gate

#### Automated

- [x] 1.1 Lint passes with the new gate active: `npm run lint` — cdc6515
- [x] 1.2 Unit tests still pass: `npm test` — cdc6515
- [x] 1.3 Build succeeds: `npm run build` — cdc6515
- [x] 1.4 Astro files unaffected — no new warnings or parser errors from `.astro` — cdc6515

#### Manual

- [ ] 1.5 Deliberate-break check proves the gate is live, then reverted

### Phase 2: Landmarks and skip link

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 5a3c6fd
- [x] 2.2 Unit tests pass: `npm test` — 5a3c6fd
- [x] 2.3 Build succeeds: `npm run build` — 5a3c6fd

#### Manual

- [ ] 2.4 Skip link is the first focusable element and visible when focused
- [ ] 2.5 Activating it moves focus into `<main>`, past the account nav
- [ ] 2.6 Landmark list shows `navigation` + `main` as siblings, `main` named "Your expedition"
- [ ] 2.7 Skip link works in map, lesson, quiz, and the unavailable fallback
- [ ] 2.8 Auth pages and `/dashboard` render no skip link and are unchanged

### Phase 3: Focus and announcement behaviour

#### Automated

- [x] 3.1 Lint passes: `npm run lint`
- [x] 3.2 Unit tests pass: `npm test`
- [x] 3.3 Build succeeds: `npm run build`

#### Manual

- [ ] 3.4 Locked checkpoints are reachable, announce as locked, and do nothing on Enter/Space
- [ ] 3.5 Returning from a panel restores focus to the activated checkpoint (lesson + quiz, multiple zones)
- [ ] 3.6 Panel announces the real title once loaded, not just "Loading…"
- [ ] 3.7 Submitting focuses the outcome panel; the outcome is spoken once, not twice
- [ ] 3.8 "Try again" focuses the first question's first option
- [ ] 3.9 Per-question correct/incorrect status is spoken
- [ ] 3.10 A forced fetch failure announces the error and leaves focus usable

### Phase 4: Manual verification pass

#### Automated

- [ ] 4.1 Full suite green from a clean checkout: `npm run lint`, `npm test`, `npm run build`

#### Manual

- [ ] 4.2 Keyboard-only guest loop completed pointer-free, focus never lost
- [ ] 4.3 Keyboard-only authenticated loop completed, including nav and sign-out
- [ ] 4.4 Screen-reader loop completed non-visually, all state conveyed
- [ ] 4.5 No double-speaking and no silent state changes at any transition
- [ ] 4.6 Reduced-motion pass loses no information (closes S-03's two open rows)
- [ ] 4.7 Guest nudge reachable, labelled, dismissible without stranding focus
- [ ] 4.8 Outcomes recorded in §Progress; deferred contrast + history items written into `change.md` §Notes
