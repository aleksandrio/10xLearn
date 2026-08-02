import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getMissionByZone } from "@/lib/content";
import { GUEST_SCORES_COOKIE } from "@/lib/guest-progress";
import { isZoneUnlockedForRequest } from "@/lib/progress";

export const prerender = false;

const querySchema = z.object({ zoneSlug: z.string().min(1) });

// Serve a zone's lesson as JSON — but only if the zone is unlocked for the
// caller: DB completions for an authed learner, the signed cookie for a guest.
// The earned-access rule is enforced here, so a direct call to a locked zone
// gets 403 regardless of what the UI shows.
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
    if (!mission?.lesson) {
      return Response.json({ error: "Lesson not found." }, { status: 404 });
    }

    return Response.json({
      mission: { id: mission.id, title: mission.title, slug: mission.slug },
      lesson: mission.lesson,
    });
  } catch {
    return Response.json({ error: "Something went wrong loading this lesson." }, { status: 500 });
  }
};
