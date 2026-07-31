import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getMissionByZoneId, getZones, gradeQuiz } from "@/lib/content";
import { isZoneUnlocked, nextZoneSlug } from "@/lib/game";
import { GUEST_PROGRESS_COOKIE, readUnlockedZones, writeUnlockedZones } from "@/lib/guest-progress";

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

  try {
    const cookieValue = context.cookies.get(GUEST_PROGRESS_COOKIE)?.value;
    const [unlocked, zones] = await Promise.all([readUnlockedZones(cookieValue), getZones(supabase)]);
    const firstSlug = zones[0]?.slug;

    if (!isZoneUnlocked(zoneSlug, firstSlug, unlocked)) {
      return Response.json({ error: "This zone is locked." }, { status: 403 });
    }

    const zone = zones.find((candidate) => candidate.slug === zoneSlug);
    const mission = zone ? await getMissionByZoneId(supabase, zone.id) : null;
    if (!mission) {
      return Response.json({ error: "Quiz not found." }, { status: 404 });
    }

    const result = await gradeQuiz(supabase, mission.id, answers);

    if (result.passed) {
      const next = nextZoneSlug(zones, zoneSlug);
      if (next) unlocked.add(next);
      await writeUnlockedZones(context.cookies, unlocked);
    }

    // The client's view of "which zones are open" — the earned set plus the
    // always-free first zone. Lets the map re-render the unlock immediately.
    const effective = new Set(unlocked);
    if (firstSlug) effective.add(firstSlug);

    return Response.json({ ...result, unlockedZones: [...effective] });
  } catch {
    return Response.json({ error: "Something went wrong grading this quiz." }, { status: 500 });
  }
};
