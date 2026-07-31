---
project: 10x-astro-starter (10xLearn)
checked_at: 2026-07-31T12:50:24Z
health_status: critical-issues
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
  critical: 1
  high: 12
  moderate: 7
  low: 2
test_runner_detected: false
ci_provider: GitHub Actions
recommended_fixes: 6
---

# Health Check — 10xLearn

Astro 6 + React 19 + Supabase + Cloudflare app, scaffolded from `10x-astro-starter`. Local development configuration is strong (strict TypeScript, ESLint + Prettier, Husky/lint-staged, a working CI pipeline). Two things pull the verdict down: a large stack of dependency advisories — all fixable in-range — and the complete absence of a test runner, which the course is about to address.

## Dependency Health

### Lockfile

```
Status: present (package-lock.json)
Package manager: npm
```

### Security Audit

```
Tool: npm audit --json
Summary: 1 CRITICAL, 12 HIGH, 7 MODERATE, 2 LOW
Direct vs transitive: 3 direct (astro HIGH, supabase MODERATE, wrangler MODERATE); remaining 19 transitive
```

Good news up front: **every advisory below has an in-range, non-breaking fix** — a single `npm audit fix` (no `--force`) resolves them without a semver-major bump.

#### CRITICAL findings

- **tar** (≤7.5.20, transitive via `supabase`) — multiple advisories, worst-case parser interpretation differential (file smuggling) plus several DoS vectors (decompression/parse DoS CVSS 7.5, negative-size infinite loop CVSS 7.5). Fix: `npm audit fix` bumps the transitive `tar` in place.

#### HIGH findings

- **astro** (≤7.0.9, **direct**) — cluster of XSS advisories: reflected XSS via unescaped slot name (CVSS 7.1), Host-header SSRF in prerendered error page (CVSS 7.5), XSS via unescaped spread attribute names, and several `transition:*` / View-Transition XSS variants. Fix: update `astro` (in-range).
- **brace-expansion, devalue, fast-uri, js-yaml, miniflare, postcss, sharp, svgo, undici, vite, ws** (all transitive) — HIGH advisories reached through the Astro / Cloudflare / build toolchains. Fix: `npm audit fix`.

#### MODERATE findings (7)

`@astrojs/language-server`, `@cloudflare/vite-plugin`, `supabase` (direct), `wrangler` (direct), `volar-service-yaml`, `yaml`, `yaml-language-server` — build/tooling-only advisories. Resolved by the same `npm audit fix`.

#### LOW findings (2)

`@babel/core` (arbitrary file read via sourceMappingURL, CVSS 3.2) and `esbuild` — both transitive, both build-time only.

### Outdated Dependencies

```
Packages with major version gaps: 4 (of 26 outdated)
```

- **typescript**: 5.9.3 → 7.0.2 (2 major versions behind — the native/Go TypeScript rewrite; treat as a deliberate, tested migration, not a routine bump)
- **eslint**: 9.39.4 → 10.8.0 (1 major behind)
- **@eslint/js**: 9.39.4 → 10.0.1 (1 major behind — move together with eslint)
- **@astrojs/cloudflare**: 13.5.0 → 14.1.7 (1 major behind)

These are informational. None are blocking; each is a breaking-change bump to plan on its own, separate from the security patch above.

## Test Suite

```
Test runner: not detected
Tests found: 0
Test execution: not attempted
```

⚠ No test runner detected. `package.json` has no `test` script, no Vitest/Jest/Playwright/Cypress config, and no `tests/`, `e2e/`, or `__tests__/` directory. The agent cannot verify its own changes without a way to run tests.

This is the single most important gap for agent-assisted development — and it happens to be exactly what you're working on now (Module 3, Lesson 4 — E2E tests). Recommended:

- **E2E**: use the `/10x-e2e` skill (per this repo's `CLAUDE.md`) to add Playwright coverage for browser-level risks. `npm create playwright@latest` scaffolds `playwright.config.ts`.
- **Unit/component**: `npm install -D vitest @testing-library/react`, add a `"test": "vitest"` script, and wire it into CI (below).

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml
```

| Stage      | Status | Notes                                                        |
|------------|--------|--------------------------------------------------------------|
| Lint       | ✓      | `npm run lint` (ESLint 9 flat config)                        |
| Test       | ✗      | no test step — no tests exist yet                            |
| Build      | ✓      | `npm run build` (astro build), with `astro sync` beforehand  |
| Type check | ⚠      | `astro sync` generates types and build type-checks `.astro`, but no explicit `astro check` / `tsc --noEmit` gate |
| Security   | ✗      | no `npm audit`, Dependabot, or CodeQL step                   |

The pipeline runs on push and PR to `main` with Node 22 and npm caching — a solid baseline. Once a test runner exists, add a `npm test` step; consider adding `npx astro check` for an explicit type gate and enabling Dependabot so advisories like the ones above surface automatically.

## Configuration

### Low severity

- **.editorconfig** — missing. Without it, contributors' editors may apply inconsistent indentation/EOL settings, producing noisy diffs. Fix: add a minimal `.editorconfig` (Prettier already enforces most of this at commit time, so impact is small). 

Everything else expected is present: `.gitignore`, `.env.example`, `.prettierrc.json`, `eslint.config.js`, and — notably — `tsconfig.json` extends `astro/tsconfigs/strict`, so **strict TypeScript is already on**. No type-strictness gap.

## Stack Assessment Cross-Reference

```
No stack-assessment.md found. Run /10x-stack-assess for quality-gate analysis.
```

## Recommended Fixes

### Fix before agent work (Category A)

### 1. Patch dependency vulnerabilities (1 CRITICAL, 12 HIGH)

**Impact**: The direct `astro` XSS/SSRF advisories touch request-handling code the agent will edit; the transitive `tar` CRITICAL and DoS chain ships in your Supabase/build tooling. Leaving them unpatched means agent-generated code inherits and may extend vulnerable paths.
**Severity**: critical
**Effort**: quick (< 5 min)
**Fix**:

```bash
npm audit fix        # all fixes are in-range and non-breaking — no --force needed
npm audit            # confirm the count drops to 0
```

### 2. Add a test runner

**Impact**: With zero tests and no `test` script, the agent has no feedback loop to verify its own changes — the highest-leverage gap for reliable agent collaboration.
**Severity**: high
**Effort**: moderate (15–30 min)
**Fix**:

```bash
# E2E (this lesson) — drive it with the /10x-e2e skill
npm create playwright@latest
# Unit/component
npm install -D vitest @testing-library/react @testing-library/jest-dom
# then add to package.json scripts: "test": "vitest"
```

### 3. Wire tests + a type gate into CI

**Impact**: A test runner the pipeline never invokes gives no protection on PRs. Adding `npm test` (and an explicit `astro check`) makes the agent's regressions visible before merge.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix**: add `- run: npm test` and `- run: npx astro check` steps to `.github/workflows/ci.yml` after `npm run lint`.

### 4. Enable automated dependency scanning

**Impact**: Today advisories only surface when someone runs `npm audit` by hand. Dependabot/CodeQL keeps the CRITICAL/HIGH count from silently climbing.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix**: add `.github/dependabot.yml` (ecosystem `npm`, weekly) and/or a `npm audit --audit-level=high` step in CI.

### 5. Plan the major-version upgrades

**Impact**: TypeScript 7, ESLint 10, and `@astrojs/cloudflare` 14 carry breaking changes; drifting further makes them harder later, and the agent may generate code against docs that assume newer versions.
**Severity**: low
**Effort**: significant (> 1 hour) — do each in its own branch with the test suite from #2 as a safety net
**Fix**: upgrade one at a time — `@astrojs/cloudflare@14` first, then `eslint@10` + `@eslint/js@10` together, then `typescript@7` last.

### 6. Add `.editorconfig`

**Impact**: Convenience — keeps editor formatting consistent for contributors before Prettier runs at commit time.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**: add a minimal `.editorconfig` (`root = true`, `indent_style = space`, `indent_size = 2`, `end_of_line = lf`, `insert_final_newline = true`).

### Addressed in upcoming lessons (Category B)

None outstanding. This project has already moved ahead of the usual Category B gaps:

- **CI/CD pipeline** — already present (`.github/workflows/ci.yml`). The [Sprint Zero z Agentem (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5) lesson covers deepening it (test + security stages, deploy).
- **Agent instruction files** — already present (`CLAUDE.md`, `AGENTS.md`). The [Agent Onboarding (M1L4)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4) lesson covers refining their content.

## Summary

```
Health status: critical-issues
```

The local development setup is genuinely good — strict TypeScript, linting and formatting with pre-commit enforcement, a working GitHub Actions pipeline, and agent instruction files already in place. Two findings drive the `critical-issues` verdict: a dependency tree carrying 1 CRITICAL and 12 HIGH advisories, and the total absence of a test runner. Both are very addressable — the security stack clears with a single non-breaking `npm audit fix`, and adding tests is precisely the work of the current lesson.

Next step: run `npm audit fix` now (Fix #1, ~2 minutes), then stand up a test runner via `/10x-e2e` / Vitest (Fix #2) and wire it into CI (Fix #3). After that the project is in strong shape for agent-assisted development.
