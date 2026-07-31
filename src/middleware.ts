import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { GUEST_PROGRESS_COOKIE, readUnlockedZones } from "@/lib/guest-progress";
import { mergeGuestUnlocksIntoAccount } from "@/lib/progress";

const PROTECTED_ROUTES = ["/dashboard"];
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const onRequest = defineMiddleware(async (context, next) => {
  // CSRF defense-in-depth: reject cross-origin state-changing requests. Modern
  // browsers send `Origin` on every POST/PUT/PATCH/DELETE; a mismatch with our
  // own origin is a cross-site submission. Requests with no `Origin` (non-browser
  // clients) fall through — SameSite=Lax auth cookies remain the backstop.
  if (STATE_CHANGING_METHODS.has(context.request.method)) {
    const origin = context.request.headers.get("origin");
    if (origin !== null && origin !== context.url.origin) {
      return new Response("Cross-origin request blocked.", { status: 403 });
    }
  }

  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  // Guest→account merge: the single choke point every auth path passes through
  // (signup-then-confirm, returning login, OAuth callback). When an authed
  // request still carries a guest cookie, fold its in-session unlocks forward
  // into the account (idempotent) and clear the cookie so this runs once.
  // Fail open — a merge hiccup must never turn a page load into a 500.
  if (supabase && context.locals.user) {
    const guestCookie = context.cookies.get(GUEST_PROGRESS_COOKIE)?.value;
    if (guestCookie) {
      try {
        const cookieUnlocked = await readUnlockedZones(guestCookie);
        await mergeGuestUnlocksIntoAccount(supabase, context.locals.user.id, cookieUnlocked);
        context.cookies.delete(GUEST_PROGRESS_COOKIE, { path: "/" });
      } catch (error) {
        // Fail open: keep the cookie so a later request retries. Log so a
        // persistently-failing merge is visible instead of silently swallowed.
        // eslint-disable-next-line no-console -- intentional server-side operational log
        console.error("guest→account progress merge failed", error);
      }
    }
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
