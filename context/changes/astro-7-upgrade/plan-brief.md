# Astro 6 → 7 Upgrade — Plan Brief

> Full plan: `context/changes/astro-7-upgrade/plan.md`
> Research: `context/changes/astro-7-upgrade/research.md`

## What & Why

Move `astro` 6.4.8 → 7.1.6 and `@astrojs/cloudflare` 13.5.0 → 14.1.7 to clear all
four open `npm audit` findings — the reason `context/foundation/health-check.md`
still reads `needs-attention`. The honest framing: the two HIGH advisories are
real but describe code paths this app doesn't execute (zero `<ClientRouter />`,
zero `transition:*`, zero `{...spread}`). The value is clearing audit noise so a
genuinely exploitable advisory is visible when it lands, plus staying on a
supported line.

## Starting Point

Astro 6.4.8 with the Cloudflare adapter, SSR (`output: "server"`), 12 `.astro`
files, 11 API routes, and 99 tests. Research ran four executable probes and found
the migration blocked by **one thing**: `overrides: { "vite": "^7.3.2" }` in
`package.json:69-71` — scaffold residue from the initial commit that matched
Astro 6's own Vite range and was a no-op. Astro 7 needs `vite ^8.0.13`; the
override forces Vite 7, the install reports zero conflicts, and the build then
dies with *"This is likely a bug in Astro."*

## Desired End State

`npm audit` reports 0 vulnerabilities. Single Vite 8, single wrangler, `sharp`
past 0.35.0, no `overrides` block left to go stale at the next major. The app
builds and — for the first time in this upgrade's history — actually serves
requests through workerd on the new adapter major.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Vite override | Delete it and bump `@astrojs/react` 5 → 6 | Single Vite 8 by natural resolution, so nothing hand-maintained is left to go stale — re-pinning to `^8.0.13` would re-arm the exact failure being fixed. | Research → Plan |
| Verification depth | Gates **+ local `wrangler dev` smoke** | All four probes stopped at `astro build`; the adapter went major and there's no deploy pipeline to catch a workerd regression later. | Plan |
| `compressHTML` | Take the new `'jsx'` default, verify visually | Pinning `compressHTML: true` would add a hand-maintained config line — structurally the same trap as the override this change deletes. | Plan |
| Ride-along scope | + declare `zod` explicitly | Three API routes import it through Astro's dep tree invisibly; one line, zero risk, and this upgrade surfaced it. | Plan |
| Install-time traps | Positive assertions, not assumptions | Both (`sharp` staying on 0.34.x, a second nested `wrangler`) fail **silently** — the probes avoided them by luck of install order. | Research → Plan |
| Source changes | None | Every Astro API this repo uses is unchanged in v7; the diff is `package.json` + lockfile. | Research |

## Scope

**In scope:** `astro` → `^7.1.6`, `@astrojs/cloudflare` → `^14.1.7`,
`@astrojs/react` → `^6.0.2`, delete `overrides`, declare `zod ^4.4.3`, regenerate
lockfile, workerd smoke pass, health-check/change.md close-out.

**Out of scope:** `typescript` 6→7, `eslint` 9→10, `@supabase/ssr` 0.10→0.12 (each
its own change); `@tailwindcss/vite` bump (unnecessary — already peers Vite 8);
hardening `src/test/api-context.ts`'s casts; adding a deploy pipeline; any
Playwright/E2E work.

## Architecture / Approach

Nothing structural changes. `src/middleware.ts`, all 11 API routes,
`astro.config.mjs`, `wrangler.jsonc`, and both Vitest stubs are untouched —
verified green across probes 2–4. Astro 7's risk is concentrated entirely in the
build pipeline (Rust compiler, Vite 8/Rolldown), not the runtime API surface. The
work is: edit five lines in `package.json` → regenerate the lock on Node 22 →
assert three resolution properties → run the gate stack → serve real requests.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Dependency graph upgrade | Five `package.json` edits, regenerated lock, trap assertions, full gate stack to `npm audit` = 0 | Both install traps fail silently — `sharp` may legally stay on the vulnerable 0.34.x, and npm nests a second wrangler rather than erroring |
| 2. Runtime verification through workerd | `npm run preview` smoke on a page, an API route, and the middleware redirect | The one surface four probes never touched; also the only check for `compressHTML: 'jsx'`, which no build artifact can reveal under `output: "server"` |
| 3. Close out | `health-check.md` Fix #1 resolved, `change.md` stamped | Thin, but skipping it means the next health check re-reports a solved problem |

**Prerequisites:** Node 22.x active (`nvm use` — `engine-strict=true` hard-fails
an install on 20.x, and the shell this was planned in was on 20.19.1); a branch
off `api-route-smoke-tests`; optionally Supabase credentials for Phase 2, else the
degraded setup-banner path is the expected render.

**Estimated effort:** ~1 session. Phase 1 is minutes of edits plus gate runtime;
Phase 2 is the manual time sink.

## Open Risks & Assumptions

- **`astro sync` must run before `lint`, not just `build`.** Without
  `.astro/types.d.ts`, `astro:env/server` is unresolvable and type-aware ESLint
  emits ~30 `no-unsafe-*` errors unrelated to the upgrade. CI handles this
  (`ci.yml:19`); a hand-run gate in a fresh tree does not.
- **`@astrojs/check` has no `astro` peer dependency at all**, so npm will never
  flag a mismatch. It passed at 0.9.9 in probes 2–4 — that's empirical evidence,
  not an upstream compatibility statement.
- **The test net is thinner than 99/99 suggests.** `src/test/api-context.ts:70,107`
  cast over a fake with 4 of `AstroCookies`' methods and 5 of `APIContext`'s ~15.
  Not triggered by v7, but it's why Phase 2 exists.
- **`astro dev` now auto-backgrounds when it detects an AI coding agent** (new in
  7.0.0). This repo is driven by Claude Code; whether that helps or disrupts the
  workflow is untested and will surface on first `npm run dev`.

## Success Criteria (Summary)

- `npm audit` reports 0 vulnerabilities, with `sharp >= 0.35.0` and a single
  `vite`/`wrangler`/`zod` copy each — asserted, not inferred.
- `lint` + `typecheck` + 99/99 tests + `build` pass, with **no** source file
  changed.
- The built Worker serves `/`, an API route, and the unauthenticated
  `/dashboard` → sign-in redirect through wrangler, with islands hydrating and
  inline-element spacing intact.
