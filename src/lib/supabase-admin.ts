import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

// Server-only admin client built from the service-role key. NEVER import this
// into client-side code — the service-role key bypasses RLS entirely. It exists
// solely for privileged operations the request-scoped anon client cannot do,
// e.g. deleting an `auth.users` row via `auth.admin.deleteUser` (account
// deletion). The FK cascade on `quiz_attempts` carries progress away.
export function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
