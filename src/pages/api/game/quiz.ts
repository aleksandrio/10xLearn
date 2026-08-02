import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getMissionByZone, getQuizQuestions } from "@/lib/content";
import { GUEST_SCORES_COOKIE } from "@/lib/guest-progress";
import { isZoneUnlockedForRequest } from "@/lib/progress";

export const prerender = false;

const querySchema = z.object({ zoneSlug: z.string().min(1) });

// Serve a zone's quiz questions (no answer key — read from the public view) as
// JSON, only if the zone is unlocked for the caller (DB completions when authed,
// signed cookie when a guest); else 403.
export const GET: APIRoute = async (context) => {
  const parsed = querySchema.safeParse({ zoneSlug: context.url.searchParams.get("zoneSlug") });
  if (!parsed.success) {
    return Response.json({ error: "A zoneSlug query parameter is required." }, { status: 400 });
  }
  const { zoneSlug } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "Content is unavailable right now." }, { status: 503 });
  }

  try {
    const cookieValue = context.cookies.get(GUEST_SCORES_COOKIE)?.value;
    const userId = context.locals.user?.id ?? null;
    if (!(await isZoneUnlockedForRequest(supabase, userId, cookieValue, zoneSlug))) {
      return Response.json({ error: "This zone is locked." }, { status: 403 });
    }

    const mission = await getMissionByZone(supabase, zoneSlug);
    if (!mission) {
      return Response.json({ error: "Quiz not found." }, { status: 404 });
    }

    const questions = await getQuizQuestions(supabase, mission.id);
    return Response.json({
      mission: { id: mission.id, title: mission.title, slug: mission.slug },
      questions,
    });
  } catch {
    return Response.json({ error: "Something went wrong loading this quiz." }, { status: 500 });
  }
};
