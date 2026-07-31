import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { resolveSiteOrigin } from "@/lib/site-url";

export const prerender = false;

// Request a password-reset email. Supabase sends a magic link that lands the
// user on /auth/update-password with a recovery session. We always confirm
// (?sent=1) regardless of whether the address has an account, to avoid leaking
// which emails are registered.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email");

  if (typeof email !== "string" || email.trim() === "") {
    return context.redirect(`/auth/forgot-password?error=${encodeURIComponent("Email is required")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/forgot-password?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const origin = resolveSiteOrigin(context.url.origin);
  // Always land on the neutral "sent" page — even on a misconfigured origin or a
  // transport error — so we never reveal whether an account exists, and a
  // Supabase outage can't 500.
  if (origin) {
    const redirectTo = new URL("/auth/update-password", origin).toString();
    try {
      await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    } catch {
      // Intentionally swallowed: the neutral redirect below is the only response.
    }
  }

  return context.redirect("/auth/forgot-password?sent=1");
};
