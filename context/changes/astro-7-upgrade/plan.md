# Astro 6 → 7 Upgrade Implementation Plan

## Overview

Move `astro` 6.4.8 → 7.1.6 and `@astrojs/cloudflare` 13.5.0 → 14.1.7 to clear all
four open `npm audit` findings (two HIGH), by **deleting** the stale
`overrides: { "vite": "^7.3.2" }` block rather than re-pinning it. The upgrade
requires no source-file changes; the entire migration is `package.json` +
`package-lock.json`, plus two install-time assertions and a runtime smoke pass
through workerd.

## Current State Analysis

Verified against the working tree at `1e3bbc5` and re-confirmed against the npm
registry on 2026-08-02.

**What is installed today:**

```
astro@6.4.8   @astrojs/cloudflare@13.5.0   @astrojs/react@5.0.4
vite@7.3.6 (forced by override)   sharp@0.34.5   zod@4.4.3 (via astro)
wrangler@4.117.0   →  npm audit: 4 vulnerabilities (2 HIGH)
```

**The single blocker.** `package.json:69-71` carries
`"overrides": { "vite": "^7.3.2" }`. `git log -S` traces it to `2b3bc05`
("Initial commit") — scaffold residue from `10x-astro-starter`, not a decision
this project made. It exactly matched `astro@6.4.8`'s own `vite ^7.3.2`
dependency, so under Astro 6 it was a no-op. Under Astro 7 (which depends on
`vite ^8.0.13`) it silently forces Vite 7, npm reports **zero peer conflicts and
0 vulnerabilities**, and the build then dies inside Astro's static-build with a
message that blames the framework:

```
Could not find the prerender entry point in the build output.
This is likely a bug in Astro.
  at getPrerenderEntryFileName (astro/dist/core/build/static-build.js:210:9)
```

**What does not change.** Every Astro API this repo touches is unchanged in v7:
`defineMiddleware`, `sequence`, the `(context, next)` handler signature,
`APIRoute`, `APIContext`, the full `AstroCookies` shape, `context.locals`,
`context.redirect`, `astro:env/server`, `envField`, and `output: "server"`. Not
one of the 24 headings in the official v7 upgrade guide touches middleware, API
routes, `astro:env`, adapters, sessions, or content collections. `src/middleware.ts`,
all 11 API routes, `astro.config.mjs`, `wrangler.jsonc`, and both Vitest stubs
compile and pass untouched (research probes 2–4, 99/99 tests green).

**Node floor is unchanged** — `astro@7.1.6` declares `engines.node >=22.12.0`,
identical to Astro 6 and to this repo's existing pin. `.nvmrc` (`22`), `.npmrc`
(`engine-strict=true`), and `package.json:engines` need no edit.

**Local environment caveat.** The shell this plan was written in reports Node
`v20.19.1`. With `engine-strict=true`, `npm install` will hard-fail until
`nvm use` selects 22.x. The research probes ran on 22.15.0. This is an
environment prerequisite, not a code change.

### Key Discoveries:

- `package.json:69-71` — the `overrides.vite` block; the single blocking change
- `package.json:24,33,25` — `@astrojs/cloudflare ^13.5.0`, `astro ^6.3.1`,
  `@astrojs/react ^5.0.4` (the Vite 7 line)
- **Overrides are conflict *suppression*, not resolution.** The one mechanism in
  `package.json` designed to overrule npm converted a detectable version
  incompatibility into a silent, misattributed build failure.
- `astro@7.1.6` `optionalDependencies.sharp` is `^0.34.0 || ^0.35.0` — it
  **permits** the vulnerable `0.34.x`. A lockfile-reusing install can legally
  keep `sharp@0.34.5` while every version in `package.json` looks correct.
- `@cloudflare/vite-plugin@1.50.0` peers `wrangler ^4.118.0` — **tighter** than
  the adapter's own `^4.83.0`. Verified live on 2026-08-02. npm resolves this by
  nesting a second wrangler rather than erroring.
- `@astrojs/cloudflare` exports `./entrypoints/preview`, so `npm run preview`
  (`astro preview`) is the workerd smoke vector — no separate wrangler command.
- `zod` is a **phantom dependency**: `src/pages/api/game/{grade,lesson,quiz}.ts:2`
  import it, it is absent from `package.json`, and it resolves through Astro's
  own dep tree (currently `zod@4.4.3`).
- `astro sync` is a hard prerequisite for **`lint`**, not just `build` — without
  `.astro/types.d.ts`, `astro:env/server` is unresolvable and type-aware ESLint
  rules emit ~30 `no-unsafe-*` errors. CI already handles this (`ci.yml:19`).
- `astro.config.mjs:17-21` documents a duplicate-React hydration bug — direct
  precedent for rejecting any outcome that leaves a split Vite graph.

## Desired End State

`npm audit` reports **0 vulnerabilities**. The resolved graph is:

```
astro@7.1.6   @astrojs/cloudflare@14.1.7   @astrojs/react@6.0.2
vite@8.x (single copy)   sharp@>=0.35.0   wrangler@4.x (single copy)
zod@4.x (single copy, explicitly declared)
```

`package.json` contains **no `overrides` block**. `npm run lint`,
`npm run typecheck`, `npm test` (99/99), and `npm run build` all pass, and the
built Worker serves real requests through `wrangler dev` — a page, an API route,
and the middleware auth redirect. `context/foundation/health-check.md` Fix #1
reads RESOLVED and the project verdict no longer cites it.

## What We're NOT Doing

Each of these is its own change; bundling them would make a failed build
ambiguous about which upgrade caused it.

- `typescript` 6 → 7 (the Go rewrite)
- `eslint` 9 → 10 + `@eslint/js`
- `@supabase/ssr` 0.10.3 → 0.12.4
- `@tailwindcss/vite` 4.2.4 → 4.3.3 — **not needed**; 4.2.4 already peers
  `vite ^5.2.0 || ^6 || ^7 || ^8`. Probe 4 raised it incidentally; that was churn.
- Pinning `compressHTML: true` in `astro.config.mjs` — decided against; see
  Implementation Approach.
- Hardening `src/test/api-context.ts`'s two `as unknown as` casts (`:70`, `:107`)
  or enforcing the `vitest.astro-env-server.stub.ts` ↔ `astro.config.mjs`
  correspondence. Both are real thin spots in the safety net, neither is
  triggered by v7.
- Adding a deploy pipeline. `.github/workflows/` contains only `ci.yml` and
  `package.json` has no deploy script; verification here is local `wrangler dev`.
- Any E2E/Playwright work — that routes through `/10x-e2e` against a plan of its
  own.

## Implementation Approach

**Delete the override; do not re-pin it.** Three fixes were probed and all three
build green:

1. Delete the override — works, but leaves *two* Vite copies (Astro/adapter on 8,
   `@astrojs/react@5` + Tailwind + Vitest on 7). This repo has been burned by
   duplicate-copy bugs (`astro.config.mjs:17-21`), so a split graph is an
   unattractive resting place.
2. Re-pin to `^8.0.13` — single Vite 8, all green. But it preserves a
   hand-maintained pin that must be remembered at the *next* major: the exact
   failure being fixed, re-armed.
3. **Delete the override AND bump `@astrojs/react` 5 → 6** — single Vite 8 by
   *natural resolution*, all green, nothing left to go stale. `@astrojs/react@6`
   is the Vite 8 release line; v5's Vite 7 pin is what caused option 1's split.

**Option 3 is what this plan implements.** It removes the failure mode rather
than re-arming it. `@astrojs/react@6.0.2` peers
`react: "^17.0.2 || ^18.0.0 || ^19.0.0"` (verified live), so React 19 support
carries over.

**Take Astro 7's `compressHTML: 'jsx'` default; verify it visually.** The
alternative — pinning `compressHTML: true` — would add a hand-maintained config
line that must be remembered and removed later. That is structurally the same
trap as the stale `vite` override this change exists to delete. Phase 2's visual
pass is the check.

**Declare `zod` explicitly.** One line, zero risk. Three API routes currently
depend on a transitive dependency of the framework, invisibly; the day Astro
drops or majors `zod`, they break with no local change. The upgrade is what
surfaced it, so it lands here.

**Assert the install-time traps rather than assuming them.** Both were surfaced
by registry analysis, not by the probes — the probes happened to avoid both. A
different install order hits them, and both fail *silently*.

## Critical Implementation Details

**Ordering: `astro sync` before the gates, not just before the build.** In a tree
whose `node_modules` was just replaced, `.astro/types.d.ts` does not exist, and
`astro:env/server` becomes unresolvable to the type-aware ESLint rules — `lint`
fails with ~30 `no-unsafe-*` errors that have nothing to do with the upgrade.
Run `npx astro sync` immediately after install, before touching lint. This is
what `ci.yml:19` does and why.

**The two traps fail silently, so they need positive assertions.** Neither
produces an error or a warning:

- `sharp` — Astro 7's range permits `0.34.x`, so a lockfile-reusing install can
  leave the advisory open with correct-looking version numbers everywhere. Assert
  the resolved version is `>= 0.35.0`; do not infer it from the Astro version.
- `wrangler` — npm satisfies `@cloudflare/vite-plugin@1.50.0`'s tighter
  `^4.118.0` peer by *nesting a second copy* rather than erroring. Assert
  `npm ls wrangler` reports exactly one.

**`zod`'s declared range must not fork the graph.** Astro 7 declares `zod ^4.3.6`
and currently resolves `4.4.3`. Declaring a range that both satisfy keeps a
single deduped copy; declaring a narrower or disjoint one silently produces two.

## Phase 1: Dependency Graph Upgrade

### Overview

Apply the five `package.json` edits, regenerate the lockfile on Node 22, assert
that neither install-time trap fired, and run the full automated gate stack to a
clean `npm audit`.

### Changes Required:

#### 1. Dependency manifest

**File**: `package.json`

**Intent**: Move the framework, adapter, and React integration to their Vite 8
release lines; delete the scaffold-residue Vite override so a single Vite 8
resolves naturally; declare the phantom `zod` dependency that three API routes
already import.

**Contract**: Five edits, four of them in `dependencies`:

```jsonc
"astro":               "^6.3.1"  →  "^7.1.6",
"@astrojs/cloudflare": "^13.5.0" →  "^14.1.7",
"@astrojs/react":      "^5.0.4"  →  "^6.0.2",   // the Vite 8 line
"zod":                 (absent)  →  "^4.4.3",   // matches astro's resolved 4.4.3
"overrides": { "vite": "^7.3.2" }  →  delete the block entirely
```

`@astrojs/check` (`^0.9.8`) floats to 0.9.9/0.9.10 on its own — no edit.
`wrangler`, `@tailwindcss/vite`, `.nvmrc`, `.npmrc`, and `engines.node` are all
already correct and must not be touched.

#### 2. Lockfile

**File**: `package-lock.json`

**Intent**: Regenerate so the new ranges resolve, rather than reusing
still-satisfiable old resolutions.

**Contract**: Produced by `npm install` on Node 22.x, not hand-edited. Expected
resolutions: `vite@8.x` single copy, `sharp@>=0.35.0`, `esbuild@>=0.28.1`,
`wrangler` single copy, `zod` single copy.

### Success Criteria:

#### Automated Verification:

- Node is 22.x before installing: `node -v` (with `engine-strict=true`, a 20.x
  shell fails `npm install` outright)
- Install succeeds and regenerates the lock: `npm install`
- `package.json` has no `overrides` block: `node -e "const p=require('./package.json'); if(p.overrides) throw new Error('overrides still present'); console.log('ok')"`
- **Trap 1** — sharp is out of the advisory range: `npm ls sharp` reports `>= 0.35.0`
- **Trap 2** — exactly one wrangler: `npm ls wrangler` reports a single copy, no nested entry
- Single Vite copy: `npm ls vite` reports one resolved version on the 8.x line
- Single zod copy under the app (the two `eslint-plugin-*` copies are pre-existing
  and out of scope): `npm ls zod`
- Audit is clean: `npm audit` reports **0 vulnerabilities**
- Types generated before linting: `npx astro sync`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Tests pass: `npm test` — expect **99/99**, same count as baseline
- Build passes: `npm run build` — specifically must NOT emit
  `Could not find the prerender entry point in the build output`

#### Manual Verification:

- Build log shows `[@astrojs/cloudflare] Injected immutable Cache-Control for /_astro/* into _headers.` — a known, harmless behavior delta introduced in adapter 13.7.0 and picked up on the way. Confirm the emitted `dist/_headers` change is acceptable before deploying.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to Phase 2.

---

## Phase 2: Runtime Verification Through workerd

### Overview

All four research probes stopped at `astro build`. No request has ever been
served through workerd on the new adapter major. This phase closes that gap
locally and doubles as the `compressHTML: 'jsx'` visual check.

### Changes Required:

No file changes. This phase is verification only.

**Vector**: `npm run preview` — `astro preview` resolves through
`@astrojs/cloudflare`'s `./entrypoints/preview` export (confirmed present in the
adapter's exports map), which boots the built Worker under wrangler. Requires a
completed `npm run build` from Phase 1.

**Environment**: no `.dev.vars` exists in this repo. Either provide Supabase
credentials locally, or accept the "cloned but not yet configured" degraded path
— in which case the setup banner is the expected render and the auth-path checks
below shift to confirming the redirect fires, not that sign-in succeeds.

### Success Criteria:

#### Automated Verification:

- The built Worker boots without error: `npm run preview` starts and stays up
- An API route responds through workerd, not just in Vitest: e.g.
  `curl -i localhost:<port>/api/game/lesson` returns a response (not a 500 from
  the adapter)

#### Manual Verification:

- `/` renders the guest loop correctly — no missing content, no hydration errors in the console
- The React islands hydrate (auth forms are interactive) — confirms the `@astrojs/react` 5 → 6 bump and the single-Vite-8 graph did not reintroduce the duplicate-React "Invalid hook call" failure documented at `astro.config.mjs:17-21`
- Middleware auth redirect fires: requesting `/dashboard` unauthenticated redirects to the sign-in page
- **`compressHTML: 'jsx'` check** — inline-element spacing renders correctly across the auth pages, `/`, and `/dashboard`. Look specifically for missing spaces between adjacent inline elements (links inside sentences, badge-next-to-text, button labels). This is the only Astro 7 change with a plausible silent user-visible effect on this app; if spacing is wrong, the fallback is adding `compressHTML: true` to `astro.config.mjs` — and recording that it is now a hand-maintained line to revisit.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Close Out

### Overview

The health check's project verdict is `needs-attention` *because* Fix #1 is
outstanding. Leaving it stale means the next health check re-reports a solved
problem.

### Changes Required:

#### 1. Health check record

**File**: `context/foundation/health-check.md`

**Intent**: Mark Fix #1 resolved with the landing commit, and re-evaluate the
project verdict now that `npm audit` is clean.

**Contract**: Fix #1's `— OUTSTANDING` marker flips to resolved; the fix moves
into the "Applied during this check" table with its commit sha (matching the
existing row format used for `85db956`). Fixes #2 and #3 keep their current
status — #2 was satisfied by `api-route-smoke-tests` (`1e3bbc5`) if that is
recorded, #3 is an open design decision and stays open. The verdict line updates
only if Fix #1 was its sole remaining cause.

#### 2. Change identity

**File**: `context/changes/astro-7-upgrade/change.md`

**Intent**: Reflect completion.

**Contract**: frontmatter `status: preparing` → `complete`, `updated` → the
landing date. The Notes section's Open Questions paragraph (`:44-49`) is now
answered by `research.md` and this plan — resolve it rather than leaving it
reading as open.

### Success Criteria:

#### Automated Verification:

- No stale OUTSTANDING marker on Fix #1: `grep -n "Upgrade Astro 6" context/foundation/health-check.md` shows the resolved form
- `change.md` frontmatter reads `status: complete`
- Docs are formatted: `npm run format` leaves no diff on the two edited files

#### Manual Verification:

- The health-check verdict paragraph reads accurately against the repo's actual state — the point is that a reader can trust it, not that it says "healthy"

---

## Testing Strategy

The safety net for this change was built deliberately by the preceding change
(`api-route-smoke-tests`, closed at `1e3bbc5`) and this plan leans on it rather
than adding to it.

### Unit / Integration Tests:

- **No new tests.** The existing 99 tests across 14 files — smoke coverage on all
  11 API routes plus `src/middleware.ts` — are exactly the surface this upgrade
  lands on. They ran green at every research probe step, which is what let the
  build failure be isolated to the bundler instead of suspected in the routes.
- The signal to watch is the **count**: 99/99. A drop means the upgrade broke
  collection or resolution, not that a specific assertion regressed.

### Manual Testing Steps:

1. `nvm use` (22.x), then `npm install` — confirm it does not fail on engines
2. `npm ls sharp` / `npm ls wrangler` / `npm ls vite` — assert the three
   resolution properties before running any gate
3. `npm audit` — expect 0 vulnerabilities
4. `npx astro sync && npm run lint && npm run typecheck && npm test && npm run build`
5. `npm run preview` — hit `/`, an API route, and `/dashboard` unauthenticated
6. Visually scan inline-element spacing on `/`, the five auth pages, and
   `/dashboard` for the `compressHTML` default change

### What the tests cannot catch:

`src/test/api-context.ts:70,107` are `as unknown as` casts over a fake with only
4 of `AstroCookies`' methods and 5 of `APIContext`'s ~15 members. If a future
Astro changes `AstroCookies.get()`'s return shape, the 99 tests keep passing
while production breaks. Not triggered by v7 — the shapes are unchanged — but the
net is thinner than the green checkmarks suggest. Phase 2's workerd pass exists
partly because of this.

## Performance Considerations

Astro 7 swaps the Go compiler for a Rust one and Vite 7 for Vite 8 (Rolldown).
Build times should improve; nothing in this plan depends on that. No runtime
performance budget applies — this is a dependency move with an unchanged runtime
API surface.

## Migration Notes

**Rollback is a single `git revert`** of the `package.json` + `package-lock.json`
commit followed by `npm install`. No data migration, no schema change, no
deployed state to unwind — and no deploy pipeline that could have shipped it.

**Do not run `npm audit fix --force`.** npm's computed remediation for every one
of these four findings is `astro@2.8.5` — a four-major downgrade. Astro 6 *cannot*
resolve `sharp` out of the vulnerable range (its `optionalDependencies.sharp` is
`^0.34.0`, and the advisory covers all of `<0.35.0`), which is why npm's
remediation is absurd. The fix is forward-only.

**Branch.** The health check called this "own branch" work. The repo is currently
on `api-route-smoke-tests`, which is closed out at `1e3bbc5` — branch before
starting.

## An honest note on urgency

The two HIGH advisories are real but **largely unreachable in this app's current
shape**. An exhaustive scan found zero `transition:*` directives, zero
`<ClientRouter />` / `ViewTransitions` / `astro:transitions` imports, and zero
`{...spread}` attributes in any of the 12 `.astro` files — so all three Astro XSS
advisories describe code paths this app does not execute. `sharp` is an optional
build-time dependency, while the adapter's default
`imageService: 'cloudflare-binding'` transforms at runtime through the Cloudflare
Images binding instead.

This does not argue against upgrading — the upgrade is clean, cheap, and
verified. It reframes *why*: the value is clearing audit noise so a genuinely
exploitable advisory is visible when it lands, plus staying on a supported line.
It also means this change does not need to be rushed ahead of a green CI window.
**One `<ClientRouter />` would make two of the three reachable.**

## References

- Research: `context/changes/astro-7-upgrade/research.md` — four executable
  probes; probe 4 is this plan's end state
- Change brief: `context/changes/astro-7-upgrade/change.md`
- Origin: `context/foundation/health-check.md:174-190` — Fix #1 and its
  sequencing note
- Prerequisite: `context/changes/api-route-smoke-tests/plan.md` — the 99-test net
- Duplicate-copy precedent: `astro.config.mjs:17-21`,
  `context/archive/2026-07-31-persist-progress-with-signup/plan.md:435`
- workerd constraint (unaffected, but adjacent):
  `context/archive/2026-07-28-guest-core-loop/plan.md:38,63` — no `node:crypto`
  in workerd; `src/lib/guest-progress.ts` uses `crypto.subtle`
- CI gate order: `.github/workflows/ci.yml:19` — `astro sync` before lint

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dependency Graph Upgrade

#### Automated

- [x] 1.1 Node is 22.x before installing (`node -v`) — 1dfe1c5
- [x] 1.2 Install succeeds and regenerates the lock (`npm install`) — 1dfe1c5
- [x] 1.3 `package.json` has no `overrides` block — 1dfe1c5
- [x] 1.4 Trap 1 — `npm ls sharp` reports `>= 0.35.0` — 1dfe1c5
- [x] 1.5 Trap 2 — `npm ls wrangler` reports a single copy — 1dfe1c5
- [x] 1.6 `npm ls vite` reports one resolved version on the 8.x line — 1dfe1c5
- [x] 1.7 `npm ls zod` reports a single copy under the app — 1dfe1c5
- [x] 1.8 `npm audit` reports 0 vulnerabilities — 1dfe1c5
- [x] 1.9 `npx astro sync` generates types before linting — 1dfe1c5
- [x] 1.10 `npm run lint` passes — 1dfe1c5
- [x] 1.11 `npm run typecheck` passes — 1dfe1c5
- [x] 1.12 `npm test` passes 99/99 — 1dfe1c5
- [x] 1.13 `npm run build` passes with no prerender-entry-point error — 1dfe1c5

#### Manual

- [x] 1.14 `dist/_headers` Cache-Control injection reviewed and accepted — 1dfe1c5

### Phase 2: Runtime Verification Through workerd

#### Automated

- [x] 2.1 `npm run preview` boots the built Worker and stays up — ce42255
- [x] 2.2 An API route responds through workerd — ce42255

#### Manual

- [x] 2.3 `/` renders the guest loop with no console hydration errors — ce42255
- [x] 2.4 React islands hydrate — no duplicate-React "Invalid hook call" — ce42255
- [x] 2.5 Unauthenticated `/dashboard` redirects to sign-in — ce42255
- [x] 2.6 `compressHTML: 'jsx'` — inline-element spacing correct across `/`, auth pages, `/dashboard` — ce42255

### Phase 3: Close Out

#### Automated

- [x] 3.1 `health-check.md` Fix #1 no longer reads OUTSTANDING
- [x] 3.2 `change.md` frontmatter reads `status: complete`
- [x] 3.3 `npm run format` leaves no diff on the edited docs

#### Manual

- [x] 3.4 Health-check verdict paragraph reads accurately against actual repo state
