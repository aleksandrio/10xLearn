---
change_id: astro-7-upgrade
title: Upgrade Astro 6 → 7 to clear the open HIGH advisories
status: complete
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Upgrade `astro` 6.4.8 → 7.1.6 and `@astrojs/cloudflare` 13.5.0 → 14.1.7 to clear
the two open HIGH advisories. Comes out of `context/foundation/health-check.md`
(2026-08-02), outstanding Fix #1 — the reason the project's health verdict is
still `needs-attention`.

What the upgrade clears:

- `astro` (direct, HIGH) — three XSS advisories whose ranges span all of 6.x:
  GHSA-4g3v-8h47-v7g6 (`>=2.9.0 <=7.0.9`), GHSA-f48w-9m4c-m7f5 (`<7.0.6`),
  GHSA-7pw4-f3q4-r2p2 (`>=3.10.0 <7.0.4`)
- `sharp` (transitive, HIGH) — GHSA-f88m-g3jw-g9cj, inherited libvips CVEs,
  range `<0.35.0`; build-time image processing only
- `@astrojs/cloudflare` (direct, MODERATE) — flagged only through `astro`
- `esbuild` (transitive, LOW) — Windows-only dev-server file read; nil exposure
  on macOS

**Do not run `npm audit fix --force`.** npm's computed remediation for every one
of these is `astro@2.8.5` — a four-major downgrade. The fix is forward-only.

Version constraints verified against the registry on 2026-08-02:
`@astrojs/cloudflare@14.1.7` declares peers `astro ^7.0.0` and
`wrangler ^4.83.0`, so the adapter and framework must move together; `wrangler`
is already 4.90.0. `npm outdated` reports nonsensical `latest` values for these
packages (registry dist-tags are disordered) — verify with `npm view`, not the
`outdated` table.

Sequencing: the prerequisite is already met. `api-route-smoke-tests` (closed at
`1e3bbc5`) put smoke coverage on all 11 API routes and `src/middleware.ts`
precisely because this upgrade lands on that surface — SSR, the Cloudflare
adapter, and the middleware API. The CI type gate (`85db956`) plus that suite are
the safety net this change leans on.

Open questions — all answered by `research.md` (four executable probes) and
`plan.md`:

- **What Astro 7 breaks in `src/middleware.ts`**: nothing. The middleware API did
  not change — `defineMiddleware`, `sequence`, the `(context, next)` signature,
  and every member the file touches are identical in v7. No source file changed
  anywhere in the repo.
- **Does `@astrojs/react@5.0.4` need to move?** Yes, but not for compatibility —
  for graph hygiene. v5 pins Vite 7; bumping to `^6.0.2` (the Vite 8 line) is what
  lets a single Vite 8 resolve naturally instead of splitting the graph.
- **Does `@astrojs/check@0.9.8` need to move?** No. It declares no `astro` peer at
  all, floats to 0.9.9 on its own, and `astro check` passes. Empirically fine,
  officially unstated.
- **Do the two Vitest stubs still match the 7.x virtual modules?** Yes, untouched;
  99/99 green at every probe.
- **Is the `vite ^7.3.2` override still needed?** It was never needed — it matched
  Astro 6's own range and was a no-op. Under Astro 7 it became the single blocker,
  silently forcing Vite 7 and killing the build with a message blaming Astro. It
  was **deleted**, not re-pinned, so nothing hand-maintained is left to go stale at
  the next major.

Outcome: `npm audit` 4 → 0. Landed at `1dfe1c5` (dependency graph), verified
through workerd at `ce42255`. `context/foundation/health-check.md` Fix #1 is
marked RESOLVED and the project verdict moved to `healthy`.

Out of scope: the other major-version gaps the health check lists —
`typescript` 6 → 7 (the Go rewrite), `eslint` 9 → 10 + `@eslint/js`, and
`@supabase/ssr` 0.10.3 → 0.12.4. Each is its own change; bundling them would make
a failed build ambiguous.
