---
date: 2026-08-02T12:40:55Z
researcher: Aleksander Kowal
git_commit: 1e3bbc5f6f8d910294a78fc2fab6a6dd2f8a6ee2
branch: api-route-smoke-tests
repository: 10xLearn
topic: "What Astro 6 → 7 actually breaks in this codebase"
tags: [research, codebase, astro, upgrade, cloudflare, vite, security, dependencies]
status: complete
last_updated: 2026-08-02
last_updated_by: Aleksander Kowal
---

# Research: What Astro 6 → 7 actually breaks in this codebase

**Date**: 2026-08-02T12:40:55Z
**Researcher**: Aleksander Kowal
**Git Commit**: `1e3bbc5`
**Branch**: `api-route-smoke-tests`
**Repository**: 10xLearn

## Research Question

`context/foundation/health-check.md` Fix #1: upgrade `astro` 6.4.8 → 7.1.6 and
`@astrojs/cloudflare` 13.5.0 → 14.1.7 to clear the two open HIGH advisories. The
health check called this "significant (> 1 hour), semver-major, own branch" and
flagged SSR, the Cloudflare adapter, and `src/middleware.ts` as the risk surface.

Before planning: **what actually breaks?**

> **Method note**: findings are backed by **four executable probes**, not by
> reading alone — continuing the convention set by
> `context/changes/api-route-smoke-tests/research.md:28`. Every probe ran in a
> throwaway `git worktree` at `1e3bbc5` on Node 22.15.0; the working tree,
> `node_modules`, and `package-lock.json` were never touched. Documentation
> research ran in parallel against the official upgrade guide, changelogs, and
> the npm registry. Where the two disagree, the probe wins.

## Summary

**Astro 7 is a build-pipeline release, not a runtime-API release.** Every API
this codebase actually depends on — `defineMiddleware`, `APIRoute`, `APIContext`,
`AstroCookies`, `context.locals`, `context.redirect`, `astro:env/server`,
`envField`, `output: "server"` — is **unchanged in v7**. Not one of the 24
headings in the official v7 upgrade guide touches middleware, API routes,
`astro:env`, adapters, sessions, or content collections.

**Exactly one thing in this repo blocks the upgrade, and it is not what the
health check predicted.** It is a stale five-word entry in `package.json`:

```json
"overrides": { "vite": "^7.3.2" }
```

`astro@7.1.6` depends on `vite ^8.0.13`. That override — inherited verbatim from
the `10x-astro-starter` scaffold at the initial commit (`2b3bc05`), where it
matched Astro 6's Vite range — silently forces Vite 7 under Astro 7. Because
`overrides` *are* npm's conflict-suppression mechanism, the install reports **zero
peer conflicts and 0 vulnerabilities**, and then the build dies with a message
that blames the framework:

```
Could not find the prerender entry point in the build output.
This is likely a bug in Astro.
  at getPrerenderEntryFileName (astro/dist/core/build/static-build.js:210:9)
```

That is the entire migration. Fix the override and the upgrade is green.

### Probe results

| # | Configuration | lint | typecheck | test | build | `npm audit` |
|---|---|---|---|---|---|---|
| 0 | **Baseline** — astro 6.4.8, adapter 13.5.0, override `vite ^7.3.2` | ✓ | ✓ | ✓ 99/99 | ✓ | **4 vulns** (2 HIGH) |
| 1 | astro 7.1.6 + adapter 14.1.7, **override kept** | ✓ | ✓ | ✓ 99/99 | ✗ | 0 |
| 2 | …**override deleted** (react 5 → two Vite copies) | ✓ | ✓ | ✓ 99/99 | ✓ | 0 |
| 3 | …**override → `^8.0.13`** (single Vite 8) | ✓ | ✓ | ✓ 99/99 | ✓ | 0 |
| 4 | …**react 6 + tailwind 4.3.3, no override** (single Vite 8, natural) | ✓ | ✓ | ✓ 99/99 | ✓ | 0 |

Probe 4 is the recommended end state. Resolved versions, all verified on disk:

```
astro@7.1.6   @astrojs/cloudflare@14.1.7   @astrojs/react@6.0.2
@astrojs/check@0.9.9   @tailwindcss/vite@4.3.3   vite@8.2.0 (single copy)
sharp@0.35.3   →  npm audit: found 0 vulnerabilities
```

**No source file needs to change.** Not `src/middleware.ts`, not any of the 11
API routes, not `astro.config.mjs`, not `wrangler.jsonc`, not the two Vitest
stubs. The change is confined to `package.json` + `package-lock.json`:

```jsonc
"astro":              "^6.3.1"  →  "^7.1.6",
"@astrojs/cloudflare": "^13.5.0" →  "^14.1.7",
"@astrojs/react":      "^5.0.4"  →  "^6.0.2",   // the Vite 8 line
"overrides": { "vite": "^7.3.2" }  →  delete the block entirely
```

`@tailwindcss/vite` needs no bump (4.2.4 already peers `vite ^5.2.0 || ^6 || ^7 || ^8`);
the probe raised it to 4.3.3 incidentally, which is optional. `@astrojs/check`
floats from `^0.9.8` to 0.9.9/0.9.10 on its own. `wrangler`, `.nvmrc`,
`engines.node`, and `.npmrc` are all already correct.

### One honest caveat on urgency

The two HIGH advisories are **real, but largely unreachable in this app's current
shape**. An exhaustive scan found **zero** `transition:*` directives, **zero**
`<ClientRouter />` / `ViewTransitions` / `astro:transitions` imports, and **zero**
`{...spread}` attributes in any `.astro` file — so all three Astro XSS advisories
describe code paths this app does not execute. And `sharp` is an *optional*
dependency of Astro used for build-time image processing, while the adapter's
default `imageService: 'cloudflare-binding'` does transformation at runtime via
the Cloudflare Images binding instead.

This does **not** argue against upgrading — the upgrade is clean, cheap, and
verified. It reframes *why*: the value is clearing audit noise so a genuinely
exploitable advisory is visible when it lands, plus staying on a supported line.
It also means the change does not need to be rushed ahead of a green CI window.
Worth stating plainly rather than letting "2 HIGH advisories" imply active
exploitability. One `<ClientRouter />` would make two of the three reachable.

## Detailed Findings

### The Vite override — root cause, and why it hid

`package.json:69-71` carries `"overrides": { "vite": "^7.3.2" }`. Provenance:
`git log -S` traces it to `2b3bc05` ("Initial commit") — it is scaffold residue,
not a deliberate decision by this project. It exactly matches
`astro@6.4.8`'s own `vite ^7.3.2` dependency, so under Astro 6 it was a no-op
that merely restated what npm would have resolved anyway.

Under Astro 7 it becomes load-bearing and wrong:

| Package | Declares | With override |
|---|---|---|
| `astro@7.1.6` | `vite ^8.0.13` | forced to 7.3.6 ✗ |
| `astro@6.4.8` | `vite ^7.3.2` | 7.3.6 ✓ |

The failure mode is the interesting part. An ordinary version conflict would
fail loudly at `npm install`. But `overrides` is *precisely the mechanism for
overruling dependency resolution*, so npm did what it was told, reported
`added 18 packages, removed 73 packages … found 0 vulnerabilities`, exit 0 — and
deferred the problem to the build, where it surfaced inside Vite's environments
API as *"This is likely a bug in Astro."* **The override converts a loud
dependency error into a silent, misattributed build failure.**

Three fixes were probed. All three make the build pass:

1. **Delete the override** (probe 2) — works, but leaves *two* Vite copies:
   Astro/adapter on 8.2.0, `@astrojs/react@5` + Tailwind + Vitest on 7.3.6.
   Green, but this repo has been burned by duplicate-copy bugs before
   (`astro.config.mjs:17-21` documents a duplicate-React hydration bug), so a
   split Vite graph is an unattractive resting place.
2. **Re-pin to `^8.0.13`** (probe 3) — single Vite 8.2.0, all green. `vitest@4.1.10`
   explicitly declares `vite ^6.0.0 || ^7.0.0 || ^8.0.0`, so it is satisfied.
   But it preserves a hand-maintained pin that must be remembered at the *next*
   major — the exact failure being fixed.
3. **Bump `@astrojs/react` 5 → 6 and delete the override** (probe 4) — single
   Vite 8.2.0 by *natural resolution*, all green, nothing left to go stale.
   `@astrojs/react@6.0.0` is the Vite 8 release line; v5 is pinned to Vite 7,
   which is what caused the split in probe 2.

**Recommendation: option 3 (probe 4).** It removes the failure mode rather than
re-arming it. `@astrojs/react@6.0.2` keeps React 19 support
(`peerDependencies.react: "^17.0.2 || ^18.0.0 || ^19.0.0"`).

### Astro 7 breaking changes, filtered to this repo

The v7 changelog lists 8 major changes. Filtered against what this codebase does:

| # | Breaking change | Applies here? |
|---|---|---|
| 1 | Vite 7 → **Vite 8** (Rolldown) | **Yes** — the whole migration (above) |
| 2 | Go → **Rust compiler**; unclosed tags now error, invalid nesting no longer auto-corrected | **No** — all 8 `.astro` files compiled clean in probes 2–4 |
| 3 | `compressHTML` default `true` → `'jsx'` | **Unverified** — see Open Questions |
| 4 | **Sätteri** replaces remark/rehype for Markdown | No — no Markdown, no content collections |
| 5 | Advanced routing on by default; **`src/fetch.ts` reserved** | No — repo has no `src/fetch.ts` |
| 6 | **`@astrojs/db` removed** | No — Supabase |
| 7 | Deprecated `astro:transitions` internals removed | No — zero `astro:transitions` usage |
| 8 | `astro dev` **auto-backgrounds when an AI agent is detected** | **Yes, as workflow** — see Open Questions |
| 9 | 5 experimental flags graduated (must be removed from config) | No — `astro.config.mjs` has no `experimental` block |

Also confirmed **unchanged** in v7, each of which the health check flagged as a
risk: `defineMiddleware` and `sequence` (the `astro:middleware` export list is
identical); the `(context, next)` handler signature; `next()` semantics;
`APIRoute` as a root type export; `context.redirect(path, status?)` defaulting to
302; the full `AstroCookies` shape (`get`/`set`/`delete`/`has`/`merge`/`headers`);
`context.locals` and `App.Locals` augmentation; `astro:env/server` and `envField`;
and `output: "server"`. v7 additions are purely additive (`context.cache`,
`context.logger`).

**Node floor is unchanged.** `astro@7.1.6` declares `engines.node >=22.12.0` —
identical to Astro 6 and to this repo's existing `package.json` pin. `.nvmrc`,
`.npmrc`, and `engines` need no edit.

### Cloudflare adapter 13.5.0 → 14.1.7

**v14.0.0 has exactly one major change: "Upgrade to Vite v8."** Every
Cloudflare-specific breaking change one might expect — `Astro.locals.runtime`
removal, `workerEntryPoint`, `cloudflareModules`, the `main` entrypoint move —
landed in **v13.0.0 / Astro 6**, which this project already runs. The repo has
zero references to `locals.runtime`, `platformProxy`, `workerEntryPoint`, or
`cloudflareModules`.

Peer ranges for `14.1.7`: `{ "astro": "^7.0.0", "wrangler": "^4.83.0" }`. The
`wrangler` range is **identical to 13.5.0's**, and the installed `wrangler`
(^4.90.0, resolved 4.117.0) already satisfies it. Only the `astro` peer moves.

**`wrangler.jsonc` needs zero changes.** `main: "@astrojs/cloudflare/entrypoints/server"`
(`:4`) is still in 14.1.7's exports map; `compatibility_date: "2026-05-08"` (`:5`)
is later than the adapter's `2026-04-15` fallback and no minimum is imposed; the
adapter never reads `compatibility_flags` (`:6`), so `nodejs_compat` stays the
project's own call. `astro.config.mjs`'s `adapter: cloudflare()` passes no
options, so nothing removed or re-defaulted applies.

One observed behavior delta, absent from the baseline build and present in every
upgraded build: `[@astrojs/cloudflare] Injected immutable Cache-Control for /_astro/* into _headers.`
That arrived in adapter **13.7.0**, so it is picked up on the way rather than
being a v14 change. Harmless, but it means the deployed `_headers` file changes.

### What the upgrade actually clears

`sharp` is the concrete win, and the mechanism is in Astro core, not the adapter:

| | `optionalDependencies.sharp` | Resolves to |
|---|---|---|
| `astro@6.4.8` | `^0.34.0` | **0.34.5** — permanently inside the advisory range `<0.35.0` |
| `astro@7.1.6` | `^0.34.0 \|\| ^0.35.0` | **0.35.3** — clear |

Astro 6 *cannot* resolve out of the vulnerable range; no amount of `npm audit fix`
would have helped, which is why npm's computed remediation was the absurd
`astro@2.8.5`. Probes 1–4 all report `found 0 vulnerabilities`.

`esbuild` clears on the same move — Astro 7 pulls `esbuild ^0.28.0` → 0.28.1,
past GHSA-g7r4-m6w7-qqqr's `>=0.27.3 <0.28.1` range. So all four findings go,
not just the two HIGH ones.

### Two install-time traps the probe got lucky on

Both were surfaced by registry analysis rather than by the probe, and the probe
happened to avoid both. They belong in the plan as explicit verification steps,
because a different install order hits them.

1. **`sharp` can silently stay vulnerable.** Astro 7's range is
   `^0.34.0 || ^0.35.0` — it *permits* 0.34.x. A lockfile-reusing install (`npm ci`,
   or `npm install` that finds the old resolution still satisfiable) can legally
   keep `sharp@0.34.5` and leave the advisory open while every version number in
   `package.json` looks correct. The probes regenerated the lock and landed on
   0.35.3, but that was not guaranteed. **Assert `sharp >= 0.35.0` after
   install**, don't infer it from the Astro version.
2. **A second `wrangler` can nest silently.** `@astrojs/cloudflare@14.1.7` depends
   on `@cloudflare/vite-plugin ^1.39.0`; at 1.50.0 that plugin peers
   `wrangler ^4.118.0` — *tighter* than the adapter's own `^4.83.0`. Pinning
   wrangler to the currently-locked 4.117.0 makes npm nest a second wrangler
   4.118.0 rather than erroring. The probes resolved `@cloudflare/vite-plugin@1.49.1`
   and so never hit it. **Check `npm ls wrangler` returns a single copy.**

Related, for the *separate* eslint change: do not let `eslint-plugin-astro` drift
to 3.0.1 — it peers `eslint >=10.0.0` while this repo is on `^9.29.0`.

### Repo coupling surface (the inventory that made the above checkable)

Complete inventory of runtime coupling to Astro, from an exhaustive scan:

- **`astro:env/server`** — 6 value imports across 5 files (`src/lib/supabase.ts:3`,
  `supabase-admin.ts:2`, `config-status.ts:1`, `site-url.ts:1`,
  `guest-progress.ts:24`). Evaluated at module-init time
  (`config-status.ts:14`). Unchanged in v7.
- **`astro:middleware`** — exactly one value import, `src/middleware.ts:1`. The
  repo's only non-env runtime `astro:*` import.
- **`astro`** — 14 imports, **all `import type`**, zero value-position. This is
  enforced by the lint rule added in the previous change
  (`eslint.config.js:111-129`).
- **`astro/config`** — `astro.config.mjs:2` (`defineConfig`, `envField`).
- **Never used anywhere**: `astro:content`, `astro:assets`, `astro:actions`,
  `astro:transitions`, `astro:schema`, `astro:i18n`, `astro:db`, `astro:env/client`.

`src/middleware.ts` touches only `context.request.method/.headers`,
`context.url.origin/.pathname`, `context.cookies`, `context.locals.user`, and
`context.redirect` — every one unchanged in v7. It never uses `params`, `props`,
`rewrite`, `session`, `clientAddress`, or `getActionResult`.

### Hidden risks the probe cannot catch

Three couplings stayed green through every probe but remain live hazards. They
are not blockers; they are things a plan should decide about explicitly.

1. **`zod` is a phantom dependency.** `grade.ts:2`, `lesson.ts:2`, and `quiz.ts:2`
   all `import { z } from "zod"`, and **`zod` is not in `package.json`**. It
   resolves through `astro`'s own dependency. Verified in the probe: under
   Astro 7 it still resolves, because both `astro@6.4.8` and `astro@7.1.6`
   declare `zod ^4.3.6` — so this upgrade does not break it. But three API
   routes depend on a transitive dependency of the framework, invisibly. The day
   Astro drops or majors zod, they break with no local change. Declaring `zod`
   explicitly is a one-line, zero-risk fix worth folding in.
2. **`src/test/api-context.ts` casts hide `APIContext` drift.** `:70` and `:107`
   are `as unknown as` casts over a fake with only 4 of `AstroCookies`' methods
   and 5 of `APIContext`'s ~15 members. If a future Astro changes
   `AstroCookies.get()`'s return shape, the 99 tests keep passing while
   production breaks. Not triggered by v7 (shapes unchanged), but the safety net
   is thinner than the green checkmarks suggest.
3. **`vitest.astro-env-server.stub.ts` is hand-synced** to `astro.config.mjs`'s
   five `envField` entries. Nothing enforces the correspondence.

## Code References

- `package.json:69-71` — the `overrides.vite` block; the single blocking change
- `package.json:24,33` — `@astrojs/cloudflare ^13.5.0`, `astro ^6.3.1`
- `package.json:25` — `@astrojs/react ^5.0.4`, the Vite 7 line
- `astro.config.mjs:10` — `output: "server"` (unchanged in v7)
- `astro.config.mjs:15-23` — the `vite` block; `resolve.dedupe` is still valid Vite 8
- `astro.config.mjs:17-21` — the duplicate-React comment; precedent for avoiding split graphs
- `astro.config.mjs:24` — `adapter: cloudflare()`, no options, so no v14 option churn
- `astro.config.mjs:25-37` — `env.schema`, five optional `envField.string()` entries
- `src/middleware.ts:1` — the repo's only `astro:middleware` value import
- `src/pages/api/game/{grade,lesson,quiz}.ts:2` — the undeclared `zod` imports
- `src/test/api-context.ts:70,107` — the two `as unknown as` casts
- `vitest.config.ts:14-15` — the two `astro:*` stub aliases
- `wrangler.jsonc:4-6` — entrypoint, compatibility date, `nodejs_compat`; all fine as-is
- `.github/workflows/ci.yml:19` — `npx astro sync` before lint/typecheck/test/build
- `eslint.config.js:111-129` — the type-only-`astro` rule from the previous change

## Architecture Insights

- **Overrides are conflict *suppression*, not conflict *resolution*.** The one
  mechanism in `package.json` designed to overrule npm is the one that turned a
  detectable version incompatibility into a misattributed build failure. Any
  `overrides` entry pinning a *transitive* dependency of a framework is a
  time bomb armed to go off at that framework's next major. This one was
  scaffold residue nobody chose.
- **The previous change paid off exactly as designed.** `api-route-smoke-tests`
  was justified as a prerequisite for this upgrade. It worked: 99 tests across
  14 files ran green at every probe step, which is what let the build failure be
  isolated to the bundler rather than suspected in the routes or middleware. The
  sequencing decision in `health-check.md:190` was correct.
- **`astro sync` is a hard prerequisite for `lint`, not just `build`.** The first
  probe's lint failed with ~30 `no-unsafe-*` errors purely because `.astro/types.d.ts`
  didn't exist yet, making `astro:env/server` unresolvable to the type-aware
  ESLint rules. CI already handles this (`ci.yml:19`); it is a trap for anyone
  running gates in a fresh checkout by hand.
- **Astro 7's risk is concentrated in the build pipeline, not the API surface.**
  For an app like this one — SSR, API routes, middleware, no Markdown, no content
  collections, no View Transitions — the runtime API surface is entirely
  unchanged, and the compiler/bundler swap is where all the risk lives.

## Historical Context (from prior changes)

- `context/changes/api-route-smoke-tests/plan.md` + `research.md` — the direct
  prerequisite, closed at `1e3bbc5`. Established the executable-probe convention
  this research follows, and the 99-test net it leans on.
- `context/archive/2026-07-28-guest-core-loop/plan.md:38,63` — **Cloudflare
  workerd has no `node:crypto`**; HMAC in `src/lib/guest-progress.ts` must use
  `crypto.subtle`. Checked against v14: the adapter's Node-compat posture is
  unchanged and `compatibility_flags: ["nodejs_compat"]` is untouched by the
  adapter, so this constraint is unaffected.
- `context/archive/2026-07-31-persist-progress-with-signup/plan.md:410-412` —
  the origin of `vitest.astro-env-server.stub.ts`; Vitest cannot resolve Astro's
  virtual modules. Same reasoning later produced the `astro:middleware` stub.
- `context/archive/2026-07-31-persist-progress-with-signup/plan.md:435` — the
  duplicate-React "Invalid hook call" bug that produced `resolve.dedupe`. Direct
  precedent for rejecting probe 2's split-Vite outcome. Notably, adapter 14.0.1
  and 14.1.2 fix upstream variants of this same class of bug.
- `context/foundation/health-check.md:174-190` — Fix #1 and its sequencing note.

## Related Research

- `context/changes/api-route-smoke-tests/research.md` — the harness research this
  builds on; its Open Question #1 (middleware coverage) was resolved by that
  change and is what makes this upgrade verifiable.

## Open Questions

1. **`compressHTML: 'jsx'` whitespace regression — unverified, and the probe
   cannot verify it.** The default changed from `true` to `'jsx'`, which strips
   whitespace between inline elements React-style. Because this app is
   `output: "server"`, no HTML is emitted at build time, so there is nothing to
   diff. This needs a running-app visual check (or setting `compressHTML: true`
   to opt out). **This is the only Astro 7 change with a plausible silent
   user-visible effect on this app.**
2. **Deploy was never exercised.** All four probes stop at `astro build`. No
   `wrangler dev`, no deploy, no request served through workerd. The adapter
   changed major versions; a smoke test against a real Worker belongs in the plan.
3. **`astro dev` auto-backgrounds when it detects an AI coding agent** (new in
   7.0.0; `astro dev stop|status|logs`, `--background`, `--ignore-lock`). This
   repo is driven by Claude Code and `CLAUDE.md` is built around `/10x-e2e`
   Playwright work. Whether this helps or breaks that workflow is untested.
4. **`@astrojs/check` compatibility is empirically fine but officially
   unstated.** It declares *no* `astro` peer dependency at all, so npm will never
   flag a mismatch. `astro check` passed in probes 2–4 at 0.9.9, which is the
   evidence that matters — but there is no upstream statement that 0.9.x
   supports Astro 7.
5. **Should `zod` be declared explicitly** as part of this change, or split out?
   It is one line and unrelated to the upgrade except that the upgrade is what
   surfaced it.
6. **Does the `vite` override get deleted or re-pinned?** Recommendation above is
   delete + bump `@astrojs/react` to 6 (probe 4). The plan should record the
   reasoning either way, because the next major will re-ask this question.
7. **`@supabase/ssr` 0.10.3 → 0.12.4 stays out of scope** (health check names it
   separately) — but it sits on the auth path and `src/lib/supabase.ts:20` passes
   Supabase's `CookieOptions` straight into Astro's `AstroCookies.set`. That
   structural assumption spans both upgrades; worth not deferring indefinitely.
