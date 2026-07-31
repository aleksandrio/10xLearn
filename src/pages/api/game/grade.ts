import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getMissionByZoneId, getZones, gradeQuiz } from "@/lib/content";
import { isZoneUnlocked, nextZoneSlug } from "@/lib/game";
import { GUEST_PROGRESS_COOKIE, readUnlockedZones, writeUnlockedZones } from "@/lib/guest-progress";
import { getUnlockedZoneSlugsForUser, recordCompletion, getTotalXpForUser, getGuestTotalXp } from "@/lib/progress";

export const prerender = false;

const bodySchema = z.object({
  zoneSlug: z.string().min(1),
  answers: z.array(z.object({ question_id: z.string().min(1), option_id: z.string().min(1) })).min(1),
});

// Grade a quiz submission and, on a pass, unlock the next zone. Grading goes
// through the RPC so the answer key never leaves the DB, and the unlock is
// derived server-side from zone order — the client never says what to unlock.
export const POST: APIRoute = async (context) => {
  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return Response.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: "zoneSlug and a non-empty answers array are required." }, { status: 400 });
  }
  const { zoneSlug, answers } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Grading is unavailable right now." }, { status: 503 });
  }

  const user = context.locals.user;

  try {
    const cookieValue = context.cookies.get(GUEST_PROGRESS_COOKIE)?.value;
    const zones = await getZones(supabase);
    const firstSlug = zones[0]?.slug;

    // The gate uses the DB-derived set for authed learners, the signed cookie
    // for guests — so a direct POST to a locked zone is rejected either way.
    let unlocked = user ? await getUnlockedZoneSlugsForUser(supabase, user.id) : await readUnlockedZones(cookieValue);

    if (!isZoneUnlocked(zoneSlug, firstSlug, unlocked)) {
      return Response.json({ error: "This zone is locked." }, { status: 403 });
    }

    const zone = zones.find((candidate) => candidate.slug === zoneSlug);
    const mission = zone ? await getMissionByZoneId(supabase, zone.id) : null;
    if (!mission) {
      return Response.json({ error: "Quiz not found." }, { status: 404 });
    }

    const result = await gradeQuiz(supabase, mission.id, answers);

    // XP is weighted per mission; the "+X XP" moment awards it only on a
    // genuinely new completion (0 on a re-pass), while `totalXp` is the derived
    // running total. Both default to the no-gain case (fail, or re-pass).
    const missionXpValue = mission.xp_value;
    let xpEarned = 0;

    if (result.passed) {
      if (user) {
        // Authed: record the completion, then recompute the effective set from
        // the DB (the unlock is derived from completions, not added by hand).
        // `recordCompletion` reports whether a row was actually inserted — a
        // re-pass ignores the unique conflict and awards no XP.
        const wasNew = await recordCompletion(supabase, user.id, mission.id);
        xpEarned = wasNew ? missionXpValue : 0;
        unlocked = await getUnlockedZoneSlugsForUser(supabase, user.id);
      } else {
        // Guest: a new completion is exactly the case where the just-passed
        // mission's next zone was not already unlocked (checked before the add).
        const next = nextZoneSlug(zones, zoneSlug);
        const wasNew = !!next && !unlocked.has(next);
        if (next) unlocked.add(next);
        await writeUnlockedZones(context.cookies, unlocked);
        xpEarned = wasNew ? missionXpValue : 0;
      }
    }

    // The running total after any write: authed reads the DB, guest derives it
    // from the (post-write) cookie unlock set — the same sums the map badge uses.
    const totalXp = user ? await getTotalXpForUser(supabase, user.id) : await getGuestTotalXp(supabase, unlocked);

    // The client's view of "which zones are open" — the earned set plus the
    // always-free first zone. Lets the map re-render the unlock immediately.
    const effective = new Set(unlocked);
    if (firstSlug) effective.add(firstSlug);

    return Response.json({ ...result, unlockedZones: [...effective], xpEarned, totalXp });
  } catch {
    return Response.json({ error: "Something went wrong grading this quiz." }, { status: 500 });
  }
};
