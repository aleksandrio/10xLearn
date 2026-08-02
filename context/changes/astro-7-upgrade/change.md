---
change_id: astro-7-upgrade
title: Upgrade Astro 6 → 7 to clear the open HIGH advisories
status: implementing
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

Open questions for research/planning: what Astro 7 breaks in `src/middleware.ts`
(the middleware API changed), whether `@astrojs/react@5.0.4` and
`@astrojs/check@0.9.8` need to move too, whether `vitest.astro-middleware.stub.ts`
and `vitest.astro-env-server.stub.ts` still match the 7.x virtual modules, and
whether the `vite ^7.3.2` override in `package.json` is still needed or now
conflicts.

Out of scope: the other major-version gaps the health check lists —
`typescript` 6 → 7 (the Go rewrite), `eslint` 9 → 10 + `@eslint/js`, and
`@supabase/ssr` 0.10.3 → 0.12.4. Each is its own change; bundling them would make
a failed build ambiguous.
