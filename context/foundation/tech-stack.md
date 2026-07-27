---
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
---

## Why this stack

10xLearn is a gamified learning web app — a world map of locked/unlocked zones, short lessons, 3-question quizzes, and accumulating XP — not an arcade/canvas game, so it needs interactive UI plus durable state rather than a rendering engine. The 10x Astro Starter (Astro + React + TypeScript + Tailwind + Supabase + Cloudflare) covers exactly that: React islands render the map, quiz, and XP interactions, while Supabase supplies the two must-haves the PRD pins down — email+password and third-party OAuth (FR-002/003) plus Postgres persistence so unlocks, quiz results, and XP survive a browser close (the core guardrail). The guest-then-signup flow (FR-001) maps cleanly onto Supabase auth. It is TypeScript-first and convention-based, which keeps a solo, after-hours build agent-friendly and fast to ship within the 3-week MVP window at small scale (<1 qps, <1GB). Cloudflare Pages is the starter's default deploy target — the cheapest path to first deploy — with GitHub Actions auto-deploying on merge to main. Scaffolding confidence is first-class. The one thing to watch: Astro's island model means cross-view client state leans on Supabase-backed persistence, which this product needs anyway.
