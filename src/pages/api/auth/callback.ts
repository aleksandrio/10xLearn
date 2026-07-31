import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

// Provider-agnostic OAuth completion. Supabase redirects back here with a
// `?code=…`; we exchange it for a session (the SSR client writes the auth
// cookies) and land on the map. The Phase-3 middleware merge then folds any
// guest progress into the account on the next authed request. No Google-specific
// logic lives here, so future providers reuse this route unchanged.
export const GET: APIRoute = async (context) => {
  const code = context.url.searchParams.get("code");
  if (!code) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Missing authorization code")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/");
};
