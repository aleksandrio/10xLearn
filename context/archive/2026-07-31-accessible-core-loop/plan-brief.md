# Accessible Core Loop — Plan Brief

> Full plan: `context/changes/accessible-core-loop/plan.md`

## What & Why

Make the full core loop — world map → lesson → quiz → unlock — completable by a
keyboard-only learner and by a screen-reader user, and verify that claim by hand.
This is roadmap slice **S-04**; the accessibility NFR gates launch
(`context/foundation/prd.md:101`), so it is not optional. It was deliberately
carved out of the north-star slice so the happy path could ship fast for
validation and then be hardened and independently verified.

## Starting Point

`guest-core-loop` built an accessible baseline in from Phase 1, and most of it
holds: semantic landmarks, composed accessible names on checkpoints, `aria-hidden`
on decorative icons, `motion-safe:` animations, visible focus rings, and an
`aria-live` announcement of the quiz outcome. But the loop's React components have
**never been a11y-linted** — `eslint.config.js` scopes `jsx-a11y` to `**/*.astro`
only, while the entire loop is `.tsx`. That hole is why a set of focus-management
and labelling gaps shipped unnoticed.

## Desired End State

A learner lands on the map, skips the nav, opens Zone 1's lesson, returns to the
map with focus back on the checkpoint they left, takes the quiz, fails, retries,
passes, and sees Zone 2 light up — using only a keyboard, and separately using only
a screen reader, without ever losing their place or meeting an unlabelled control.
Static a11y regressions now fail CI.

## Key Decisions Made

| Decision              | Choice                                        | Why (1 sentence)                                                                                            | Source |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| Scope                 | Core loop + shared `Layout`                   | Matches the slice's stated outcome; a skip link can only live in `Layout`.                                    | Plan   |
| Verification standard | `jsx-a11y` on `.tsx` + manual checklist       | Fixes the root cause, and an SR claim is one only a human can honestly make; no new test infrastructure.      | Plan   |
| Lint severity         | `strict`, not `recommended`                   | Dry-run shows both pass clean on the current tree, so strict is free today and catches more later.             | Plan   |
| Focus on map return   | Restore to the originating checkpoint          | Standard dialog-return pattern; keeps the learner's place on a long trail.                                     | Plan   |
| Locked checkpoints    | Focusable via `aria-disabled`, not `disabled`  | Makes "more zones exist ahead" discoverable by Tab, matching what a sighted learner sees.                      | Plan   |
| Quiz outcome channel  | Focus the result panel, drop the `aria-live`   | Focus + live region would double-speak; the composed sentence moves inside the focused panel as `sr-only`.      | Plan   |
| Colour contrast       | Deferred, recorded as an owned risk            | Small-text tokens sit near 4.5:1 and are unmeasured; keeps this slice to keyboard + screen reader.              | Plan   |
| Browser Back          | Out of scope, documented                       | Not a WCAG criterion, every view has an in-page "Back to map", and view→URL mapping is an architecture change. | Plan   |

## Scope

**In scope:** `WorldMap.tsx`, `LessonPanel.tsx`, `QuizPanel.tsx`, `Layout.astro`,
`index.astro`, `eslint.config.js`. Skip link + landmark structure; locked-checkpoint
discoverability; focus restoration across every view transition; single-channel
outcome announcement; text alternatives for correctness icons; recorded manual
keyboard and screen-reader passes.

**Out of scope:** colour contrast; browser history / Back; auth pages and
`/dashboard`; axe, Playwright, or component tests; mobile/reflow/zoom; any change to
grading, unlocking, XP, or persistence.

## Architecture / Approach

Gate first, then fix, then verify. Turning the lint on before any edits means every
later phase is written under the guard. The page shell is corrected before the
focus work, because moving the account `<nav>` out of `<main>` changes the DOM that
the focus model sits inside. All changes are presentational — markup, refs, and
focus effects — with no data-flow, endpoint, or state-machine changes.

## Phases at a Glance

| Phase                      | What it delivers                                              | Key risk                                                                       |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. A11y lint gate          | `jsx-a11y` strict covering `**/*.{jsx,tsx}` in CI              | The imported flat config has no `files` key — unscoped, it leaks onto `.astro`  |
| 2. Landmarks + skip link   | Opt-in skip link; `<nav>` out of `<main>`; shared skip target   | A fixed target would dangle on auth/dashboard, which render no `<main>`         |
| 3. Focus + announcements   | Focus survives every transition; outcome spoken exactly once    | Restore must run in an effect — the map's refs are null while a panel is mounted |
| 4. Manual verification     | Recorded keyboard-only and screen-reader passes of the loop     | Human-gated; a real gap found here may reopen Phase 3                          |

**Prerequisites:** S-01 (`guest-core-loop`) implemented — it is. A screen reader
available on the dev machine (VoiceOver on macOS). No new dependencies:
`eslint-plugin-jsx-a11y@6.10.2` is already in `devDependencies`.

**Estimated effort:** ~1–2 sessions. Phases 1–3 are small, well-bounded diffs;
Phase 4 is the time sink, since the screen-reader pass has to be walked in real time.

## Open Risks & Assumptions

- **Unmeasured contrast is a live launch risk.** `text-slate-500` at 10–12px on
  `bg-slate-950` may fail WCAG AA. Deferred by decision and written into
  `change.md` §Notes so it has an owner — but the accessibility NFR gates launch,
  so it will need answering before then.
- **Removing the `aria-live` region is the plan's most reversible-but-debatable
  call.** If the Phase 3 focus move proves unreliable in some SR/browser pairing,
  the outcome would go unannounced; Phase 4's "spoken exactly once" check is the
  guard, and reinstating the live region is the fallback.
- **Refocusing panel headings on `status` change** assumes the user has not moved
  focus in the ~100 ms before content lands. Safe in practice — `status` changes at
  most once per panel mount — but it is an assumption.
- **No CI regression guard for focus behaviour.** Static lint cannot catch a broken
  focus restore; a future change can silently regress it. Accepted tradeoff of the
  chosen verification standard.
- **Assumption:** exactly one view is mounted at a time, so the single shared
  `#main-content` id is never duplicated. True today by construction.

## Success Criteria (Summary)

- A keyboard-only learner completes the entire loop — guest and authenticated —
  without touching a pointer, with focus visible at every step and never lost.
- A screen-reader user completes the same loop non-visually, with lock state,
  question correctness, the outcome, and the unlock all conveyed — the outcome
  spoken exactly once.
- `npm run lint` now fails on React accessibility violations, proven by a
  deliberate-break check.
