import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { resolveSiteOrigin } from "@/lib/site-url";

export const prerender = false;

// Start the Google OAuth flow server-side so the redirect URL is built from the
// deploy origin (never a client secret in the browser). Supabase returns a URL
// to send the user to; we redirect there. The origin comes from PUBLIC_SITE_URL
// in production (fail closed if unset) — see resolveSiteOrigin.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const origin = resolveSiteOrigin(context.url.origin);
  if (!origin) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Sign-in is temporarily unavailable")}`);
  }
  const redirectTo = new URL("/api/auth/callback", origin).toString();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });

  if (error || !data.url) {
    const message = error?.message ?? "Could not start Google sign-in";
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  return context.redirect(data.url);
};
