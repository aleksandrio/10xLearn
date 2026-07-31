# Repository Guidelines

Astro 6 SSR app with React 19 islands, Tailwind 4, shadcn/ui, and Supabase auth, deployed to Cloudflare Workers. See @CLAUDE.md.scaffold for the full architecture notes and @README.md for setup.

## Hard Rules

- API routes must export `const prerender = false` (full SSR, `output: "server"`).
- Merge Tailwind classes with the `cn()` helper from `@/lib/utils` — never concatenate class strings manually.
- No Next.js directives (`"use client"`, etc.); this is Astro, not Next.
- New Supabase tables: enable RLS with granular per-operation, per-role policies.
- Route protection lives in `src/middleware.ts` — add paths to `PROTECTED_ROUTES` to require auth.

## Build, Test, and Development Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime.
- `npm run build` — production SSR build via `@astrojs/cloudflare`.
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules.
- `npm run format` — Prettier (astro + tailwindcss plugins).
- `npx supabase start` — local Supabase stack (requires Docker).
- `npx wrangler deploy` — deploy to Cloudflare Workers.

Node v22.14.0 (`.nvmrc`). Env vars `SUPABASE_URL`, `SUPABASE_KEY` — copy `.env.example` to `.env` (Node) or `.dev.vars` (Cloudflare local).

## Project Structure

`src/pages/` (routes; `api/` for endpoints), `src/components/` (`ui/` shadcn, `auth/`), `src/layouts/`, `src/lib/` (services/helpers), `src/middleware.ts`, `src/types.ts` (shared entities/DTOs). Path alias `@/*` → `./src/*`.

## Coding Style & Conventions

- Astro components for static content/layout; React only when interactivity is needed. Extract hooks to `src/components/hooks/`.
- API endpoints: uppercase `GET`/`POST` exports; validate input with zod.
- shadcn/ui: "new-york" variant in `src/components/ui/`; add via `npx shadcn@latest add [name]`.
- Migrations: `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`.

Pre-commit: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.

## E2E Testing

Use the `/10x-e2e` skill (see @CLAUDE.md). Playwright locators: `getByRole`/`getByLabel`/`getByText` first, never CSS/XPath. Never `page.waitForTimeout()` — wait on state.

## CI

`.github/workflows/ci.yml` runs lint + build on every push/PR to `main`. Set `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets.
