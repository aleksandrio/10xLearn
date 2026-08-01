---
change_id: accessible-core-loop
title: Accessible core loop
status: implementing
created: 2026-07-31
updated: 2026-08-01
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

### Verification status

Automated gates are green and committed (Phases 1–3). The manual keyboard-only
and screen-reader passes — the deliverable Phase 4 is judged on — were explicitly
waived for this run and remain **unchecked** in the plan's §Progress. The
accessibility claim is therefore evidenced by static lint plus behavioural
checks, not yet by a human non-visual walk of the loop.
