import type { APIRoute } from "astro";
import { PUBLIC_SITE_URL } from "astro:env/server";
import { createClient } from "@/lib/supabase";

export const prerender = false;

// Start the Google OAuth flow server-side so the redirect URL is built from the
// deploy origin (never a client secret in the browser). Supabase returns a URL
// to send the user to; we redirect there. `PUBLIC_SITE_URL` pins the origin in
// deployed/proxied environments; locally it falls back to the request origin.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const origin = PUBLIC_SITE_URL ?? context.url.origin;
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
