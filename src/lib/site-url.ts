import { PUBLIC_SITE_URL } from "astro:env/server";

// Resolve the site origin used to build auth redirect/callback URLs. In
// production we REQUIRE `PUBLIC_SITE_URL` and fail closed (return null) — the
// origin must never be derived from the request Host, which a client controls.
// In dev we fall back to the request origin so local setups work without extra
// config. Callers redirect with an error (or a neutral response) on null rather
// than minting a request-Host-based URL. Mirrors the fail-closed secret() guard
// in src/lib/guest-progress.ts.
export function resolveSiteOrigin(requestOrigin: string): string | null {
  const configured = PUBLIC_SITE_URL?.trim() ? PUBLIC_SITE_URL : null;
  if (configured) return configured;
  return import.meta.env.PROD ? null : requestOrigin;
}
