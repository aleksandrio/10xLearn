---
project: 10x-astro-starter (10xLearn)
checked_at: 2026-08-02T02:15:00Z
health_status: needs-attention
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
  high: 2
  moderate: 1
  low: 1
test_runner_detected: true
ci_provider: GitHub Actions
recommended_fixes: 3
---

# Health Check — 10xLearn

Astro 6 + React 19 + Supabase + Cloudflare app, scaffolded from `10x-astro-starter`. The foundation is strong: strict TypeScript, ESLint + Prettier with pre-commit enforcement, a four-stage CI pipeline, a Vitest suite passing 37/37, and both agent instruction files in place.

**Seven of the nine findings from this check were fixed and committed during it** (`85db956`, `4d18740`). What remains is the Astro 6 → 7 security upgrade and test coverage beyond `src/lib/`. The verdict stays `needs-attention` because the two HIGH advisories are still open.

## Why the Node finding kept coming back

Worth recording, because it shaped the fix. The 01:52 check reported the Node runtime as fixed; ten minutes later this check opened on Node **v20.19.1** with the build broken again. The earlier fix was `nvm use`, which changes **machine state for one shell**. Nothing about it was durable, shared, or visible to anyone else.

Tracing it properly turned up two Node providers, with the winner depending on how the shell is launched:

| Shell | nvm loaded? | Resolves to |
|---|---|---|
| Interactive (`.zshrc` sources `nvm.sh`) | yes | nvm default — was **20.19.1** |
| Non-interactive login (`.zshrc` skipped) | no | Homebrew **26.5.0** on `PATH` |

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
Summary: 0 CRITICAL, 2 HIGH, 1 MODERATE, 1 LOW  (unchanged by this session's fixes)
Direct vs transitive: 2 direct (astro HIGH, @astrojs/cloudflare MODERATE); 2 transitive (sharp HIGH, esbuild LOW)
```

⚠ **`npm audit fix` does not resolve these, and `--force` is actively harmful here.** npm's suggested remediation for every finding below is `astro@2.8.5` — a downgrade across four major versions from the installed 6.4.8. Do not run `npm audit fix --force` on this project. The real fix is a forward upgrade to Astro 7 (Fix #1 outstanding).

#### HIGH findings

- **astro** 6.4.8 (**direct**) — a cluster of XSS advisories whose ranges span the entire 6.x line:
  - [GHSA-4g3v-8h47-v7g6](https://github.com/advisories/GHSA-4g3v-8h47-v7g6) — reflected XSS via unescaped View Transition animation properties (range `>=2.9.0 <=7.0.9`)
  - [GHSA-f48w-9m4c-m7f5](https://github.com/advisories/GHSA-f48w-9m4c-m7f5) — XSS via unescaped spread attribute names in `renderHTMLElement`; incomplete fix for CVE-2026-54298 (range `<7.0.6`)
  - [GHSA-7pw4-f3q4-r2p2](https://github.com/advisories/GHSA-7pw4-f3q4-r2p2) — XSS via unescaped `transition:*` directive values on hydrated islands (range `>=3.10.0 <7.0.4`)

  Fix: upgrade to `astro@^7.1.6` (verified latest; clears all three ranges).

- **sharp** 0.34.5 (transitive, via `astro`) — [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj): inherited libvips vulnerabilities (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591), range `<0.35.0`. Build-time image processing only. Rides along with the Astro 7 upgrade.

#### MODERATE findings

- **@astrojs/cloudflare** 13.5.0 (**direct**) — flagged transitively through `astro`; no advisory of its own. Clears when Astro moves, but `@astrojs/cloudflare@14` requires `astro ^7.0.0`, so the two must be upgraded together.

#### LOW findings

- **esbuild** (transitive, via `astro`) — [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr): arbitrary file read when running the dev server on Windows (CVSS 2.5). This project develops on macOS; exposure is effectively nil.

### Outdated Dependencies

```
Packages with major version gaps: 5
```

- **astro**: 6.4.8 → 7.1.6 (also the security fix)
- **@astrojs/cloudflare**: 13.5.0 → 14.1.7 (must move with `astro`)
- **typescript**: 6.0.3 → 7.0.2 (the native/Go rewrite; a deliberate, tested migration)
- **eslint**: 9.39.4 → 10.8.0
- **@eslint/js**: 9.39.4 → 10.0.1 (must move together with `eslint`)

Also: **@supabase/ssr** 0.10.3 → 0.12.4. Pre-1.0, so minor bumps carry breaking changes — treat it like a major. It sits directly on the auth path, so pair the upgrade with a run of the auth tests.

Remaining drift is patch/minor and now arrives as batched Dependabot PRs.

> A caveat on the tooling: `npm outdated` reports nonsensical "latest" values here (`astro` as 6.0.5 when 7.1.6 is published). Registry dist-tags for these packages are disordered. Every version above was verified with `npm view` and `npm ls`, not taken from the `outdated` table.

## Test Suite

```
Test runner: Vitest
Tests found: 37 tests across 2 files
Test execution: passing (683ms)
```

```
Configuration: vitest.config.ts (plus vitest.setup.ts, vitest-env.d.ts, vitest.astro-env-server.stub.ts)
Framework: Vitest 4.1.10, jsdom 29, @testing-library/react 16 + jest-dom 7 + user-event 14
```

Test files: `src/lib/progress.test.ts`, `src/lib/utils.test.ts`. The suite runs in CI, so the agent has a working feedback loop.

Two gaps, both still open:

- **Coverage is confined to `src/lib/`.** Of 49 files under `src/`, two library modules are covered. Nothing under `src/pages/api/` (8 auth routes, 3 game routes), `src/components/`, or `src/db/` — the API routes and auth flows are the parts most likely to break silently.
- **No E2E layer.** No `playwright.config.*` or `cypress.config.*`. This repo's `CLAUDE.md` is built around the `/10x-e2e` skill, so the browser tier is the natural next step rather than a defect.

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml
```

| Stage      | Status | Notes                                                                   |
|------------|--------|-------------------------------------------------------------------------|
| Lint       | ✓      | `npm run lint` (ESLint 9 flat config)                                   |
| Test       | ✓      | `npm test` (Vitest) — 37/37                                             |
| Build      | ✓      | `npm run build`, with `npx astro sync` and Supabase env secrets         |
| Type check | ✓      | **added this session** — `npm run typecheck` (`astro check`)            |
| Security   | ✓      | **added this session** — Dependabot (npm weekly, actions monthly)       |

Runs on push and PR to `main`, npm caching. Node now comes from `node-version-file: .nvmrc` rather than a hardcoded `22`, so CI and local resolve from one source. Locally, Husky + lint-staged run `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` at commit time.

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

  Requiring these at build time would break the starter's intentional "cloned but not yet configured" onboarding path. The residual risk — a *production* deploy missing a secret degrading quietly instead of refusing to start — is real but wants a deploy-time or runtime assertion, not a build-time env requirement. That is a design decision, logged below rather than applied.

Everything else expected is present: `.gitignore` (with `.env`, `.dev.vars`, `.wrangler/` excluded — `git ls-files` confirms only `.env.example` is tracked), `.prettierrc.json`, `eslint.config.js`, `.husky/pre-commit`, `components.json`, `wrangler.jsonc`, `CLAUDE.md`, `AGENTS.md`. `tsconfig.json` extends `astro/tsconfigs/strict`, so strict TypeScript is on — and now enforced in CI.

## Stack Assessment Cross-Reference

```
No stack-assessment.md found. Run /10x-stack-assess for quality-gate analysis.
```

## Recommended Fixes

### Fix before agent work (Category A)

### 1. Upgrade Astro 6 → 7 (clears both HIGH advisories) — OUTSTANDING

**Impact**: Resolves the direct `astro` XSS cluster and the transitive `sharp` libvips HIGH in one move. This is also the fix npm cannot compute for you.
**Severity**: high
**Effort**: significant (> 1 hour) — semver-major; own branch
**Fix**:

```bash
# do NOT run `npm audit fix --force` — it would install astro@2.8.5, a 4-major downgrade
npm install astro@^7.1.6 @astrojs/cloudflare@^14.1.7
npm audit            # expect HIGH to drop to 0
npm run lint && npm run typecheck && npm test && npm run build
```

`@astrojs/cloudflare@14` declares `astro ^7.0.0` and `wrangler ^4.83.0`; wrangler is already 4.x. `@astrojs/react` supports React 19 on both Astro lines, so the island setup carries over. Review the Astro 7 upgrade guide for config and adapter changes before merging.

**Sequencing note**: do Fix #2 first, at least partially. This upgrade touches SSR and the Cloudflare adapter, and the API routes it most affects currently have zero coverage — the type gate added this session helps, but it will not catch a route that stops responding correctly.

### 2. Extend test coverage past `src/lib/` — OUTSTANDING

**Impact**: All 37 tests live in two files under `src/lib/`. The API routes under `src/pages/api/`, the auth components, and `src/db/` carry the product's real risk (persistence, auth, XP accrual) and have no coverage. An agent editing those paths gets no signal from the suite — and the Astro 7 upgrade above lands squarely on them.
**Severity**: medium (high, if taken as a prerequisite for Fix #1)
**Effort**: moderate (15–30 min) for smoke coverage; ongoing thereafter
**Fix**: start with smoke tests for the API routes — enough that the suite fails if a route stops responding — then use the `/10x-e2e` skill for browser-level risks (guest→signup, quiz submission, XP persisting across sessions). Per this repo's `CLAUDE.md`, `/10x-e2e` is the single source of truth for that workflow. This is design work; route it through `/10x-plan` rather than an ad-hoc sweep.

### 3. Decide how production should react to missing secrets — OUTSTANDING (design)

**Impact**: See "Reviewed and deliberately not changed" above. A production deploy missing `SUPABASE_URL` / `SUPABASE_KEY` currently degrades to the setup banner instead of refusing to start. Correct for local onboarding, questionable for production.
**Severity**: low today; rises when you deploy
**Effort**: moderate — needs a decision, not a command
**Fix**: pick a boundary. Options: assert on server start when `import.meta.env.PROD`, add a deploy-time preflight check in the release pipeline, or accept the degraded banner as intended production behavior. Whichever you choose, write it down — the current behavior reads as an oversight even though it is deliberate.

### Applied during this check

| # | Fix | Commit |
|---|-----|--------|
| 1 | Node runtime enforced in-repo (`engines`, `engine-strict`, `.nvmrc`, CI `node-version-file`) | `85db956` |
| 2 | Type-check gate — `typecheck` script + CI step | `85db956` |
| 3 | Dependabot — npm weekly (minor/patch grouped), actions monthly | `4d18740` |
| 4 | Tailwind source scoping — `source(none)` + `@source "../../src"` | `4d18740` |
| 5 | Dead `@astrojs/sitemap` integration removed | `4d18740` |
| 6 | `.editorconfig` added | `4d18740` |
| 7 | `.env` re-synced with `.env.example` (`PUBLIC_SITE_URL`) | local only — `.env` is gitignored |

Row 7 is the one piece of machine-local state in this list, and the only one that can silently drift again. Everything else is in version control.

### Addressed in upcoming lessons (Category B)

None outstanding:

- **CI/CD pipeline** — present, now covering lint, typecheck, test, build, and dependency scanning. [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5) covers deploy stages.
- **Agent instruction files** — `CLAUDE.md` and `AGENTS.md` both present. [Agent Onboarding: Agents.md, AI Rules i feedback loops (M1L4)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4) covers refining their content.
- **Deployment configuration** — `wrangler.jsonc` and the Cloudflare adapter are configured; also M1L5.

## Summary

```
Health status: needs-attention
```

The local toolchain is now whole and, more importantly, self-defending. The Node problem that regressed between two checks is fixed at the repo level rather than in one shell: a wrong runtime now fails at `npm install` with a message naming the required and actual versions, instead of surfacing later as an opaque Astro error. CI and local read the Node version from the same file, so they cannot drift apart again. Type checking is enforced, dependency scanning is automated, and the build emits zero warnings.

The verdict stays `needs-attention` for one reason: the two HIGH Astro/sharp advisories are still open, and clearing them means a real 6 → 7 major upgrade — `npm audit fix --force` would downgrade the framework four majors instead of fixing anything.

Next step: put smoke tests on the API routes (Fix #2) before taking the Astro 7 upgrade (Fix #1), since the upgrade lands on exactly the code that has no coverage. Route both through `/10x-plan` — they are design work, not a config sweep.
