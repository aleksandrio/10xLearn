---
change_id: api-route-smoke-tests
title: API route smoke tests
status: implementing
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Comes out of `context/foundation/health-check.md` (2026-08-02), outstanding Fix #2.

All 37 existing tests live in two files under `src/lib/`. Nothing covers
`src/pages/api/` — 8 auth routes and 3 game routes — which is where persistence,
auth, and XP accrual actually happen.

Scope is smoke coverage, not exhaustive: enough that the suite fails if a route
stops responding correctly. Deliberately not E2E — browser-level risks route
through `/10x-e2e` per this repo's `CLAUDE.md`.

Sequencing: this is a prerequisite for the Astro 6 → 7 upgrade (health-check
Fix #1, which clears the two open HIGH advisories). That upgrade touches SSR and
the Cloudflare adapter and lands squarely on these uncovered routes. The CI type
gate added in `85db956` helps but will not catch a route that stops responding.

Constraint worth carrying into planning: `vitest.config.ts` deliberately avoids
Astro's full Vite pipeline (the Cloudflare adapter's plugins break Vitest's
runner worker), and maps `astro:env/server` to a stub. Route tests will need to
work within that, or justify changing it.
