import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";

export const prerender = false;

// Permanently delete the caller's account. The request-scoped anon client can't
// remove an `auth.users` row, so we use the server-only service-role admin
// client. The FK cascade on `mission_completions` carries their progress away.
// Rejects unauthenticated callers — only `locals.user` may delete itself.
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const admin = createAdminClient();
  const supabase = createClient(context.request.headers, context.cookies);
  if (!admin || !supabase) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Account deletion is unavailable")}`);
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return context.redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }

  await supabase.auth.signOut();
  return context.redirect("/");
};
