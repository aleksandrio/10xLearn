---
change_id: accessible-core-loop
title: Accessible core loop
status: implemented
created: 2026-07-31
updated: 2026-08-02
archived_at: null
---

## Notes

### Deferred, still open — launch-gating NFR follow-ups

Both were deferred by explicit decision during planning. Neither is closed; the
accessibility NFR (`context/foundation/prd.md:101`) gates launch, so both need an
answer before then.

**1. Small-text colour contrast is unmeasured.** `text-slate-500` at `text-[10px]`
/ `text-xs` on `bg-slate-950` sits near the 4.5:1 AA line and has never been
measured. Affected tokens, by component:

- `WorldMap.tsx` — the zone number eyebrow (`Zone 01`, `text-[10px]`), the
  checkpoint type label (`text-[10px]`), and the "Answer all N questions" hint
  style shared with the panels.
- `QuizPanel.tsx` — the submit hint (`text-xs text-slate-500`) and the question
  number prefix (`text-sm text-slate-500`).

Deferred because measuring and re-toning the palette is a design pass, not a
focus/labelling one, and this slice was scoped to keyboard + screen reader.
Owner: whoever takes the pre-launch NFR sweep. Fix is likely a single token swap
(`slate-500` → `slate-400`) plus a contrast check of the amber-on-dark pills.

**2. View switching never touches the URL, so browser Back exits the loop.**
`map ⇄ lesson ⇄ quiz` is React state only (`WorldMap.tsx:31`). Pressing Back
mid-lesson leaves the app entirely rather than returning to the map. Not a WCAG
criterion and every view carries an in-page "Back to map", so it is not an
accessibility defect — but it is a real usability trap, and mapping views to URLs
is an architecture change (SSR entry points, deep links, panel state on load) that
did not belong in this slice. Owner: unassigned; revisit when deep-linking to a
zone is needed.

### Verification status — read before trusting the checkmarks

**3. The screen-reader verification never happened.** Every §Progress row is
checked, but the manual keyboard-only and screen-reader passes were waived by the
owner on 2026-08-02 and closed on that basis. Each row carries its own annotation:
`verified`, `partial` (static or behavioural evidence only), or `waived; not
performed`. The slice's headline claim — *a screen-reader user can complete the
loop non-visually* — sits in the third category.

What the code **is** backed by: `jsx-a11y` strict now gating every `.tsx` in CI
(proven live by a deliberate-break probe), plus throwaway behavioural checks run
during implementation and deleted before commit — locked-checkpoint inertness,
focus restoration to the originating checkpoint, heading re-focus on load, result-
panel focus with the outcome sentence present exactly once, "Try again" landing on
option 1, and a graded-request failure keeping focus off `<body>`.

The specific risk this leaves open is the one the plan itself flagged: Phase 3
traded the `aria-live` region for a focus move, and "spoken exactly once" was the
check meant to confirm that trade. If the focus move turns out silent in some
screen-reader/browser pairing, the quiz outcome is announced **not at all** —
worse than the double-speaking it replaced. Reinstating the `aria-live` region is
the documented fallback. Treat this as the first thing to check in the pre-launch
NFR sweep, alongside items 1 and 2 above.
