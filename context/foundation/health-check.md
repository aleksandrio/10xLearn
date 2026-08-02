---
project: 10x-astro-starter (10xLearn)
checked_at: 2026-08-02T02:15:00Z
amended_at: 2026-08-02T15:10:00Z
health_status: healthy
context_type: greenfield
language_family: js
stack_assessment_available: false
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 0
  moderate: 0
  low: 0
test_runner_detected: true
ci_provider: GitHub Actions
recommended_fixes: 3
---

# Health Check — 10xLearn

Astro 7 + React 19 + Supabase + Cloudflare app, scaffolded from `10x-astro-starter`. The foundation is strong: strict TypeScript, ESLint + Prettier configured, a four-stage CI pipeline, a Vitest suite passing 99/99, and both agent instruction files in place.

**Seven of the nine findings from this check were fixed and committed during it** (`85db956`, `4d18740`). The Astro 6 → 7 security upgrade that kept the verdict at `needs-attention` landed later the same day (`1dfe1c5`), clearing all four advisories.

> **Amended 2026-08-02** after the `astro-7-upgrade` change. Fix #1 is resolved and the verdict is now `healthy`. The `checked_at` timestamp is unchanged — this is an amendment to the original record, not a fresh check.
>
> Sections touched: the audit block, Outdated Dependencies, the test-suite counts and gaps, the CI/CD note, Fix #1, Fix #2, and the summary. One **new** finding was turned up along the way and logged as Fix #4: the pre-commit hook is configured but never installed, so the local lint/format gate this document originally described has never actually run. The intro line above was corrected accordingly — it previously claimed "pre-commit enforcement" and "37/37".
>
> Re-run `/10x-health-check` for a full re-scan.

## Why the Node finding kept coming back

Worth recording, because it shaped the fix. The 01:52 check reported the Node runtime as fixed; ten minutes later this check opened on Node **v20.19.1** with the build broken again. The earlier fix was `nvm use`, which changes **machine state for one shell**. Nothing about it was durable, shared, or visible to anyone else.

Tracing it properly turned up two Node providers, with the winner depending on how the shell is launched:

| Shell                                    | nvm loaded? | Resolves to                   |
| ---------------------------------------- | ----------- | ----------------------------- |
| Interactive (`.zshrc` sources `nvm.sh`)  | yes         | nvm default — was **20.19.1** |
| Non-interactive login (`.zshrc` skipped) | no          | Homebrew **26.5.0** on `PATH` |

So "the Node version" was never one thing. The fix therefore had to move into the repo, where it survives shells and applies to every contributor and agent. That is what Fix #1 below now does; `nvm alias default` is only the machine-local half.

## Dependency Health

### Lockfile

```
Status: present (package-lock.json)
Package manager: npm
```

### Security Audit

```
Tool: npm audit --json
Summary: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW  (all four cleared by the Astro 7 upgrade, 1dfe1c5)
```

✅ **All four findings below are resolved.** They are kept on the record because the _way_ they resolved is worth remembering: `npm audit fix --force` would have installed `astro@2.8.5` — a four-major downgrade — for every one of them. The real fix was forward, to `astro@7.1.6` + `@astrojs/cloudflare@14.1.7` (Fix #1, now resolved).

The blocker turned out not to be any Astro API. It was `overrides: { "vite": "^7.3.2" }` in `package.json` — scaffold residue from the initial commit that was a no-op under Astro 6 and silently forced Vite 7 under Astro 7, producing a build failure that blamed the framework. Deleting it (rather than re-pinning) plus bumping `@astrojs/react` to the Vite 8 line resolved a single Vite 8 naturally.

#### HIGH findings (resolved)

- **astro** 6.4.8 (**direct**) — a cluster of XSS advisories whose ranges span the entire 6.x line:
  - [GHSA-4g3v-8h47-v7g6](https://github.com/advisories/GHSA-4g3v-8h47-v7g6) — reflected XSS via unescaped View Transition animation properties (range `>=2.9.0 <=7.0.9`)
  - [GHSA-f48w-9m4c-m7f5](https://github.com/advisories/GHSA-f48w-9m4c-m7f5) — XSS via unescaped spread attribute names in `renderHTMLElement`; incomplete fix for CVE-2026-54298 (range `<7.0.6`)
  - [GHSA-7pw4-f3q4-r2p2](https://github.com/advisories/GHSA-7pw4-f3q4-r2p2) — XSS via unescaped `transition:*` directive values on hydrated islands (range `>=3.10.0 <7.0.4`)

  **Resolved** at `astro@7.1.6` — past all three ranges.

  One thing worth recording for calibration: these three were real but **unreachable in this app's shape**. An exhaustive scan found zero `transition:*` directives, zero `<ClientRouter />` / `astro:transitions` imports, and zero `{...spread}` attributes in any `.astro` file. The value of clearing them was removing noise so a genuinely exploitable advisory is visible when it lands — not defusing an active exploit. One `<ClientRouter />` would have made two of the three reachable.

- **sharp** 0.34.5 (transitive, via `astro`) — [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj): inherited libvips vulnerabilities (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591), range `<0.35.0`. Build-time image processing only. **Resolved** at `sharp@0.35.3`.

  Astro 6 _could not_ resolve out of this range — its `optionalDependencies.sharp` was `^0.34.0` and the advisory covered all of `<0.35.0`. That is why npm's computed remediation was the absurd `astro@2.8.5`. Note that Astro 7's range (`^0.34.0 || ^0.35.0`) still _permits_ the vulnerable line, so a lockfile-reusing install can silently re-open this. Assert the resolved version, don't infer it from the Astro version.

#### MODERATE findings (resolved)

- **@astrojs/cloudflare** 13.5.0 (**direct**) — flagged transitively through `astro`; no advisory of its own. **Resolved** at `14.1.7`, moved in lockstep with `astro` as required.

#### LOW findings (resolved)

- **esbuild** (transitive, via `astro`) — [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr): arbitrary file read when running the dev server on Windows (CVSS 2.5). This project develops on macOS; exposure was effectively nil. **Resolved** at `esbuild@0.28.1`, pulled in by Astro 7.

### Outdated Dependencies

```
Packages with major version gaps: 3  (was 5; astro and @astrojs/cloudflare closed at 1dfe1c5)
```

- ~~**astro**: 6.4.8 → 7.1.6~~ — done (`1dfe1c5`); `@astrojs/react` 5 → 6 rode along, and the stale `overrides.vite` block was deleted
- ~~**@astrojs/cloudflare**: 13.5.0 → 14.1.7~~ — done (`1dfe1c5`)
- **typescript**: 6.0.3 → 7.0.2 (the native/Go rewrite; a deliberate, tested migration)
- **eslint**: 9.39.4 → 10.8.0
- **@eslint/js**: 9.39.4 → 10.0.1 (must move together with `eslint`)

Also: **@supabase/ssr** 0.10.3 → 0.12.4. Pre-1.0, so minor bumps carry breaking changes — treat it like a major. It sits directly on the auth path, so pair the upgrade with a run of the auth tests.

Remaining drift is patch/minor and now arrives as batched Dependabot PRs.

> A caveat on the tooling: `npm outdated` reports nonsensical "latest" values here (`astro` as 6.0.5 when 7.1.6 is published). Registry dist-tags for these packages are disordered. Every version above was verified with `npm view` and `npm ls`, not taken from the `outdated` table.

## Test Suite

```
Test runner: Vitest
Tests found: 99 tests across 14 files   (was 37 across 2; API smoke coverage landed at 1e3bbc5)
Test execution: passing (1.94s)
```

```
Configuration: vitest.config.ts (plus vitest.setup.ts, vitest-env.d.ts, vitest.astro-env-server.stub.ts)
Framework: Vitest 4.1.10, jsdom 29, @testing-library/react 16 + jest-dom 7 + user-event 14
```

The suite runs in CI, so the agent has a working feedback loop.

Of the two gaps this check opened with, one closed:

- ~~**Coverage is confined to `src/lib/`.**~~ Closed by `api-route-smoke-tests` (`1e3bbc5`): smoke coverage now spans all 11 API routes plus `src/middleware.ts`. That net is what made the Astro 7 upgrade verifiable — 99/99 stayed green at every probe step, which is what let the build failure be isolated to the bundler instead of suspected in the routes. `src/components/` and `src/db/` are still uncovered.
- **No E2E layer.** Still open. No `playwright.config.*` or `cypress.config.*`. This repo's `CLAUDE.md` is built around the `/10x-e2e` skill, so the browser tier is the natural next step rather than a defect.

A caveat the green count hides: `src/test/api-context.ts:70,107` are `as unknown as` casts over a fake with 4 of `AstroCookies`' methods and 5 of `APIContext`'s ~15 members. If a future Astro changes `AstroCookies.get()`'s return shape, the 99 tests keep passing while production breaks.

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml
```

| Stage      | Status | Notes                                                             |
| ---------- | ------ | ----------------------------------------------------------------- |
| Lint       | ✓      | `npm run lint` (ESLint 9 flat config)                             |
| Test       | ✓      | `npm test` (Vitest) — 99/99                                       |
| Build      | ✓      | `npm run build`, with `npx astro sync` and Supabase env secrets   |
| Type check | ✓      | **added this session** — `npm run typecheck` (`astro check`)      |
| Security   | ✓      | **added this session** — Dependabot (npm weekly, actions monthly) |

Runs on push and PR to `main`, npm caching. Node now comes from `node-version-file: .nvmrc` rather than a hardcoded `22`, so CI and local resolve from one source.

⚠ **The local pre-commit gate is configured but not active** — corrected 2026-08-02, see Fix #4. `.husky/pre-commit` and the `lint-staged` config are both present and tracked, but nothing installs the hook: `core.hooksPath` is unset, `.git/hooks/pre-commit` does not exist, `.husky/_/` was never generated, and `package.json` has no `prepare` script to run `husky`. So `eslint --fix` and `prettier --write` do **not** run at commit time in a fresh clone. This check's original text claimed they did.

## Configuration

### Resolved this session

- **Node runtime enforcement** — see the section above for why the previous per-shell fix failed. Now guarded in-repo: `engines.node >=22.12.0` in `package.json`, `engine-strict=true` in a new `.npmrc`, `.nvmrc` relaxed to `22`, and CI reading `node-version-file: .nvmrc`. Verified both directions: `npm install` on Node 20 fails with a legible `EBADENGINE` naming the required and actual versions; on Node 22 it installs clean with no dependency-engines fallout across 994 packages.

- **Tailwind source scoping** — Tailwind v4 auto-detected sources from the project root, sweeping in the markdown under `.claude` and compiling bracketed prose (`[file:line]`, `[tool:pytest]`) into arbitrary-property utilities: a build warning plus dead CSS in the shipped bundle. Now pinned with `source(none)` + `@source "../../src"`. Verified absent from the emitted CSS.

- **Dead sitemap integration** — `@astrojs/sitemap` was registered but skipped on every build (it needs a static `site` origin, which is not set), producing a warning per build and no sitemap. Removed, with a note in `astro.config.mjs` for re-adding it alongside `site` when SEO matters.

- **`.editorconfig`** — added.

- **`.env` drift** — `PUBLIC_SITE_URL` was documented in `.env.example` but missing locally; added.

**The build is now warning-free** (it emitted two before) and lint, typecheck, and tests all pass on Node 22.15.0.

### Reviewed and deliberately not changed

- **Environment variables declared `optional: true`.** This check initially flagged the all-optional env schema as a silent-failure risk and proposed making `SUPABASE_URL` / `SUPABASE_KEY` required. Reading the consuming code first showed that would be wrong:
  - `src/lib/config-status.ts` treats missing Supabase config as a **supported degraded state**, rendering a user-facing setup banner with a docs link.
  - `src/lib/supabase.ts` returns early rather than constructing a client.
  - `src/lib/guest-progress.ts` and `src/lib/site-url.ts` already fail closed in production with explicit, commented guards.

  Requiring these at build time would break the starter's intentional "cloned but not yet configured" onboarding path. The residual risk — a _production_ deploy missing a secret degrading quietly instead of refusing to start — is real but wants a deploy-time or runtime assertion, not a build-time env requirement. That is a design decision, logged below rather than applied.

Everything else expected is present: `.gitignore` (with `.env`, `.dev.vars`, `.wrangler/` excluded — `git ls-files` confirms only `.env.example` is tracked), `.prettierrc.json`, `eslint.config.js`, `.husky/pre-commit`, `components.json`, `wrangler.jsonc`, `CLAUDE.md`, `AGENTS.md`. `tsconfig.json` extends `astro/tsconfigs/strict`, so strict TypeScript is on — and now enforced in CI.

## Stack Assessment Cross-Reference

```
No stack-assessment.md found. Run /10x-stack-assess for quality-gate analysis.
```

## Recommended Fixes

### Fix before agent work (Category A)

### 1. Upgrade Astro 6 → 7 (clears both HIGH advisories) — RESOLVED (`1dfe1c5`)

Landed 2026-08-02 via the `astro-7-upgrade` change. `npm audit` reports 0 vulnerabilities. Planning and execution are recorded in `context/changes/astro-7-upgrade/`.

What actually shipped, versus what this check predicted:

- **The prediction was wrong about where the risk was.** This check flagged SSR, the Cloudflare adapter, and `src/middleware.ts`. Every Astro API this repo touches is unchanged in v7 — `defineMiddleware`, `APIRoute`, `APIContext`, `AstroCookies`, `context.locals`, `context.redirect`, `astro:env/server`, `output: "server"`. **No source file changed.** The diff was `package.json` + `package-lock.json`.
- **The real blocker was `overrides: { "vite": "^7.3.2" }`** — scaffold residue from the initial commit. It matched Astro 6's own Vite range (a no-op) and silently forced Vite 7 under Astro 7, killing the build with _"This is likely a bug in Astro."_ Overrides are conflict **suppression**, not resolution: the one mechanism designed to overrule npm turned a detectable version incompatibility into a misattributed build failure.
- **It was deleted, not re-pinned.** `@astrojs/react` moved 5 → 6 (the Vite 8 line) so a single Vite 8 resolves naturally, leaving nothing hand-maintained to go stale at the next major.
- **Rode along**: `zod ^4.4.3` declared explicitly — three API routes had been importing it through Astro's dependency tree, invisibly.
- **Verified through workerd** (`ce42255`), not just at `astro build`: API routes, the middleware auth redirect, and React island hydration all served real requests locally.

**The sequencing note below was correct and paid off.** Fix #2's smoke coverage landed first (`1e3bbc5`) and stayed green at every upgrade probe, which is what let the build failure be isolated to the bundler rather than suspected in the routes.

### 2. Extend test coverage past `src/lib/` — PARTIALLY RESOLVED (`1e3bbc5`); E2E still open

**Impact**: The API-route half is done — `api-route-smoke-tests` (`1e3bbc5`) took the suite from 37 tests across 2 files to **99 across 14**, covering all 11 API routes plus `src/middleware.ts`. What remains uncovered: `src/components/`, `src/db/`, and the browser tier.
**Severity**: low for the remaining server-side gap; medium for the missing E2E layer
**Effort**: moderate — design work, not a sweep
**Fix**: use the `/10x-e2e` skill for browser-level risks (guest→signup, quiz submission, XP persisting across sessions). Per this repo's `CLAUDE.md`, `/10x-e2e` is the single source of truth for that workflow. Route it through `/10x-plan` rather than an ad-hoc sweep.

### 3. Decide how production should react to missing secrets — OUTSTANDING (design)

**Impact**: See "Reviewed and deliberately not changed" above. A production deploy missing `SUPABASE_URL` / `SUPABASE_KEY` currently degrades to the setup banner instead of refusing to start. Correct for local onboarding, questionable for production.
**Severity**: low today; rises when you deploy
**Effort**: moderate — needs a decision, not a command
**Fix**: pick a boundary. Options: assert on server start when `import.meta.env.PROD`, add a deploy-time preflight check in the release pipeline, or accept the degraded banner as intended production behavior. Whichever you choose, write it down — the current behavior reads as an oversight even though it is deliberate.

### 4. Wire up the pre-commit hook — OUTSTANDING (found 2026-08-02, during `astro-7-upgrade`)

**Impact**: `.husky/pre-commit` (`npx lint-staged`) and the `lint-staged` config are both tracked, but the hook is never installed — `core.hooksPath` is unset, `.git/hooks/pre-commit` is absent, `.husky/_/` was never generated, and there is no `prepare` script. The local `eslint --fix` / `prettier --write` gate that this document originally claimed to run at commit time has, in this clone, never run. The visible symptom: 85 files fail `prettier --check`, and every change to date has committed its docs unformatted.
**Severity**: low — CI still runs lint, typecheck, test, and build, so nothing broken reaches `main`. This is a lost fast-feedback loop, not a correctness hole.
**Effort**: trivial to wire up (`"prepare": "husky"` plus one run); the judgement call is what to do about the formatting backlog.
**Fix**: add `"prepare": "husky"` to `package.json` scripts and run it. Then handle the backlog separately — a single repo-wide `npm run format` commit is the clean option, but keep it on its own so it does not contaminate a feature diff. Note the interaction: once the hook is live, the first commit touching any unformatted file will reformat it silently, which is how a one-line change turns into a 400-line diff.

**How this stayed hidden**: nothing ever fails. An inactive hook is indistinguishable from a passing one at the terminal — you commit, it succeeds, and the absent reformat looks like "already formatted". It only surfaced here because this change's plan asserted `npm run format` would leave no diff, and it did not.

### Applied during this check

| #   | Fix                                                                                          | Commit                            |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Node runtime enforced in-repo (`engines`, `engine-strict`, `.nvmrc`, CI `node-version-file`) | `85db956`                         |
| 2   | Type-check gate — `typecheck` script + CI step                                               | `85db956`                         |
| 3   | Dependabot — npm weekly (minor/patch grouped), actions monthly                               | `4d18740`                         |
| 4   | Tailwind source scoping — `source(none)` + `@source "../../src"`                             | `4d18740`                         |
| 5   | Dead `@astrojs/sitemap` integration removed                                                  | `4d18740`                         |
| 6   | `.editorconfig` added                                                                        | `4d18740`                         |
| 7   | `.env` re-synced with `.env.example` (`PUBLIC_SITE_URL`)                                     | local only — `.env` is gitignored |

Row 7 is the one piece of machine-local state in this list, and the only one that can silently drift again. Everything else is in version control.

### Applied after this check

| #   | Fix                                                                                                                                      | Commit    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 8   | Recommended Fix #2 (partial) — smoke coverage on all 11 API routes + `src/middleware.ts`; 37 → 99 tests                                  | `1e3bbc5` |
| 9   | Recommended Fix #1 — Astro 6 → 7 + adapter 13 → 14 + `@astrojs/react` 5 → 6; stale `overrides.vite` deleted, `zod` declared; audit 4 → 0 | `1dfe1c5` |
| 10  | Runtime verification of #9 through workerd — API routes, middleware redirect, island hydration, `compressHTML`                           | `ce42255` |

### Addressed in upcoming lessons (Category B)

None outstanding:

- **CI/CD pipeline** — present, now covering lint, typecheck, test, build, and dependency scanning. [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5) covers deploy stages.
- **Agent instruction files** — `CLAUDE.md` and `AGENTS.md` both present. [Agent Onboarding: Agents.md, AI Rules i feedback loops (M1L4)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4) covers refining their content.
- **Deployment configuration** — `wrangler.jsonc` and the Cloudflare adapter are configured; also M1L5.

## Summary

```
Health status: healthy
```

The toolchain is now whole, and the parts that matter most are self-defending. The Node problem that regressed between two checks is fixed at the repo level rather than in one shell: a wrong runtime now fails at `npm install` with a message naming the required and actual versions, instead of surfacing later as an opaque Astro error. CI and local read the Node version from the same file, so they cannot drift apart again. Type checking is enforced, dependency scanning is automated, and the build emits zero warnings.

The qualifier is Fix #4: the _local_ half of that enforcement — the pre-commit hook — is configured but not installed, so in practice CI is the only gate that actually runs. That is a weaker position than this document originally described, and the reason it went unnoticed is instructive: an inactive hook never fails, so it is indistinguishable from a passing one.

The verdict moved to `healthy` because the one thing holding it back — the Astro/sharp advisory cluster — is closed. `npm audit` reports 0 findings, the API surface has 99 smoke tests behind it, and the built Worker has been exercised through workerd.

**What `healthy` does and does not mean here.** It means: no open advisories, a green four-stage CI pipeline, enforced types, and a test suite that covers the server-side surface where this product's risk actually lives. It does not mean finished. Three things stay open:

- **No E2E layer** (Fix #2's remaining half). `src/components/` and `src/db/` are uncovered, and there is no browser tier. Route it through `/10x-e2e`.
- **No deploy pipeline.** `.github/workflows/` has only `ci.yml`, and `package.json` has no deploy script. Everything verified so far is local. Fix #3 — how production should react to missing secrets — cannot be meaningfully resolved until there is a production to deploy to, which is why it stays open as a design decision rather than a task.
- **The pre-commit hook is not installed** (Fix #4, found during this upgrade). The local lint/format gate this document previously claimed to run has never run in this clone. CI still catches everything, so the verdict does not move — but the fast-feedback loop that was supposed to catch problems before CI does not exist.

One calibration note worth carrying forward. The two HIGH advisories that drove this check's `needs-attention` verdict turned out to be **unreachable in this app's shape** — zero `<ClientRouter />`, zero `transition:*`, zero `{...spread}`. The upgrade was still worth doing, but for a different reason than urgency: clearing the noise so a genuinely exploitable advisory is visible when it lands. Treat "2 HIGH" as a prompt to check reachability, not as a statement of exposure.

Next step: the browser tier via `/10x-e2e`, then a deploy pipeline — at which point Fix #3 becomes answerable.
