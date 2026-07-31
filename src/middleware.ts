import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { GUEST_PROGRESS_COOKIE, readUnlockedZones } from "@/lib/guest-progress";
import { mergeGuestUnlocksIntoAccount } from "@/lib/progress";

const PROTECTED_ROUTES = ["/dashboard"];

export const onRequest = defineMiddleware(async (context, next) => {
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
      } catch {
        // Log-and-continue: keep the cookie so a later request can retry.
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
