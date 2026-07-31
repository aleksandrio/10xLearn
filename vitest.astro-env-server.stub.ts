// Test stub for the `astro:env/server` virtual module. Astro generates that
// module at build time from the `env` schema in astro.config.mjs; Vitest runs
// outside the Astro pipeline and can't resolve it, so vitest.config.ts aliases
// the specifier to this file. Values are inert — a unit test that needs real
// config should mock the consuming module instead of relying on these.
export const SUPABASE_URL = "";
export const SUPABASE_KEY = "";
export const GUEST_PROGRESS_SECRET = "";
export const PUBLIC_SITE_URL = "";
export const SUPABASE_SERVICE_ROLE_KEY = "";
