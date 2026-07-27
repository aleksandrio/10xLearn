---
bootstrapped_at: 2026-07-27T19:30:11Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: 10x-learn
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Consumed from `context/foundation/tech-stack.md`.

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-learn
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

**Why this stack** (verbatim from hand-off body):

10xLearn is a gamified learning web app — a world map of locked/unlocked zones, short lessons, 3-question quizzes, and accumulating XP — not an arcade/canvas game, so it needs interactive UI plus durable state rather than a rendering engine. The 10x Astro Starter (Astro + React + TypeScript + Tailwind + Supabase + Cloudflare) covers exactly that: React islands render the map, quiz, and XP interactions, while Supabase supplies the two must-haves the PRD pins down — email+password and third-party OAuth (FR-002/003) plus Postgres persistence so unlocks, quiz results, and XP survive a browser close (the core guardrail). The guest-then-signup flow (FR-001) maps cleanly onto Supabase auth. It is TypeScript-first and convention-based, which keeps a solo, after-hours build agent-friendly and fast to ship within the 3-week MVP window at small scale (<1 qps, <1GB). Cloudflare Pages is the starter's default deploy target — the cheapest path to first deploy — with GitHub Actions auto-deploying on merge to main. Scaffolding confidence is first-class. The one thing to watch: Astro's island model means cross-view client state leans on Supabase-backed persistence, which this product needs anyway.

## Pre-scaffold verification

| Signal      | Value                                                   | Severity | Notes                                                        |
| ----------- | ------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| npm package | not run                                                 | —        | `cmd_template` starts with `git clone`; no npm CLI to check  |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card `docs_url`; fetched via public GitHub API (`gh` unauthenticated) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20
**Conflicts (.scaffold siblings)**: CLAUDE.md (existing kept; scaffold copy → `CLAUDE.md.scaffold`)
**.gitignore handling**: moved silently (no pre-existing `.gitignore` in cwd)
**.bootstrap-scaffold cleanup**: deleted (`.git/` removed before move-up so upstream history did not leak)

**Toolchain note**: `npm install` succeeded but emitted `EBADENGINE` warnings — the starter requires Node ≥22.12.0; this machine ran Node v20.19.1 / npm 10.8.2. Install completed; Astro 6 / Wrangler / Miniflare may misbehave at dev/build until Node is upgraded.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 1 CRITICAL, 12 HIGH, 7 MODERATE, 2 LOW (22 total)
**Direct vs transitive**: 0/1/2/0 direct of total 1/12/7/2 — the single CRITICAL and 11 of 12 HIGH are transitive; only `astro` (HIGH) and `supabase` + `wrangler` (MODERATE) are direct dependencies.

Exit code: 1 (non-zero because vulnerabilities exist — informational only; not a halt). Full JSON captured during the run; per-finding summary below.

#### CRITICAL findings

- **tar** (range `<=7.5.20`, transitive, fix available) — node-tar cluster: PAX header file smuggling (GHSA-vmf3-w455-68vh), process crash via numeric path type confusion (GHSA-w8wr-v893-vjvp), decompression/parse DoS (GHSA-23hp-3jrh-7fpw), infinite loop on negative entry size (GHSA-8x88-c5mf-7j5w), uncaught-exception DoS via NUL byte (GHSA-gvwx-54wh-qm9j), uncontrolled recursion stack-overflow DoS (GHSA-r292-9mhp-454m).

#### HIGH findings

- **astro** (range `<=7.0.9`, **direct**, fix available) — multiple XSS + SSRF advisories: reflected XSS via unescaped slot name (GHSA-8hv8-536x-4wqp), host-header SSRF in prerendered error page fetch (GHSA-2pvr-wf23-7pc7), XSS via unescaped spread-prop attribute names (GHSA-jrpj-wcv7-9fh9), XSS via View Transition animation props (GHSA-4g3v-8h47-v7g6), XSS via renderHTMLElement spread names (GHSA-f48w-9m4c-m7f5), XSS via `transition:*` directives on hydrated islands (GHSA-7pw4-f3q4-r2p2).
- **brace-expansion** (range `<=5.0.7`, transitive, fix available) — exponential-time and unbounded-length expansion DoS (GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg).
- **devalue** (range `5.6.3 - 5.8.0`, transitive, fix available) — DoS via sparse array deserialization (GHSA-77vg-94rm-hx3p).
- **fast-uri** (range `3.0.0 - 3.1.3`, transitive, fix available) — host confusion via literal backslash authority delimiter (GHSA-v2hh-gcrm-f6hx) and failed IDN canonicalization (GHSA-4c8g-83qw-93j6).
- **js-yaml** (range `4.0.0 - 4.2.0`, transitive, fix available) — quadratic-complexity DoS in merge-key handling (GHSA-h67p-54hq-rp68, GHSA-52cp-r559-cp3m).
- **miniflare** (range `3.20250204.0 - 4.20260721.0`, transitive, fix available) — inherited via sharp / undici / ws.
- **postcss** (range `<=8.5.17`, transitive, fix available) — path traversal in source-map auto-loading → arbitrary `.map` disclosure (GHSA-r28c-9q8g-f849).
- **sharp** (range `<0.35.0`, transitive, fix available) — inherited libvips CVEs (GHSA-f88m-g3jw-g9cj).
- **svgo** (range `4.0.0 - 4.0.1`, transitive, fix available) — removeScripts plugin leaves some executable scripts intact (GHSA-2p49-hgcm-8545).
- **undici** (range `7.0.0 - 7.27.2`, transitive, fix available) — TLS validation bypass, header injection, WS DoS, proxy routing, response-queue poisoning, SameSite downgrade, cache disclosure (GHSA-vmh5-mc38-953g and others).
- **vite** (range `7.0.0 - 7.3.3`, transitive, fix available) — `server.fs.deny` bypass on Windows alternate paths (GHSA-fx2h-pf6j-xcff), NTLMv2 hash disclosure via launch-editor (GHSA-v6wh-96g9-6wx3).
- **ws** (range `8.0.0 - 8.20.1`, transitive, fix available) — uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx) and fragment DoS (GHSA-96hv-2xvq-fx4p).

#### MODERATE findings (log only)

- **supabase** (**direct**), **wrangler** (**direct**), **@astrojs/language-server**, **@cloudflare/vite-plugin**, **volar-service-yaml**, **yaml**, **yaml-language-server** — 7 total.

#### LOW / INFO findings (log only)

- **@babel/core**, **esbuild** — 2 total.

**Note**: `npm audit fix` is available but was NOT run — bootstrapper informs, it does not auto-patch. Many fixes are non-major; review before applying, especially the `astro` direct upgrade.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` (the conflict policy kept your existing `CLAUDE.md`) and decide which version of each file to keep.
- Upgrade Node to ≥22.12.0 (the starter's `.nvmrc` pins the intended version) before running `npm run dev` / `npm run build` — the current v20.19.1 triggers `EBADENGINE`.
- Address audit findings per your project's risk tolerance — the full breakdown is above. The direct `astro` HIGH is the most actionable; the CRITICAL `tar` is transitive.
