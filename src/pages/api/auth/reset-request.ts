import type { APIRoute } from "astro";
import { PUBLIC_SITE_URL } from "astro:env/server";
import { createClient } from "@/lib/supabase";

export const prerender = false;

// Request a password-reset email. Supabase sends a magic link that lands the
// user on /auth/update-password with a recovery session. We always confirm
// (?sent=1) regardless of whether the address has an account, to avoid leaking
// which emails are registered.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/forgot-password?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const origin = PUBLIC_SITE_URL ?? context.url.origin;
  const redirectTo = new URL("/auth/update-password", origin).toString();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  return context.redirect("/auth/forgot-password?sent=1");
};
