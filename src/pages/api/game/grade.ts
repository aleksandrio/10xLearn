import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getMissionByZoneId, getZones, gradeQuiz } from "@/lib/content";
import { isZoneUnlocked } from "@/lib/game";
import {
  GUEST_SCORES_COOKIE,
  readGuestScores,
  writeGuestScores,
  type GuestScore,
  type GuestScores,
} from "@/lib/guest-progress";
import {
  getUnlockedZonesForRequest,
  getUnlockedZoneSlugsForUser,
  getUnlockedZoneSlugsForGuest,
  getBestAttemptForMission,
  recordAttempt,
  xpForAttempt,
  getTotalXpForUser,
  getTotalXpForGuest,
  type Attempt,
} from "@/lib/progress";

export const prerender = false;

const bodySchema = z.object({
  zoneSlug: z.string().min(1),
  answers: z.array(z.object({ question_id: z.string().min(1), option_id: z.string().min(1) })).min(1),
});

/** A guest's stored best score as an `Attempt`, so both paths compare like with like. */
function guestScoreAsAttempt(missionId: string, score: GuestScore | undefined): Attempt | null {
  if (!score) return null;
  return {
    missionId,
    correctCount: score.correctCount,
    questionTotal: score.questionTotal,
    passed: score.questionTotal > 0 && score.correctCount >= score.questionTotal,
  };
}

// Grade a quiz submission, bank the XP its score is worth, and on a pass unlock
// the next zone. Grading goes through the RPC so the answer key never leaves the
// DB, and the unlock is derived server-side from zone order — the client never
// says what to unlock.
//
// Retakes (S-04): every attempt is recorded and scored, so a learner can come
// back and improve. `attemptXp` is what this submission is worth; `xpEarned` is
// what it *added* to the total (the gain over their previous best, so the total
// can rise but never inflate); `isRecord` says whether it beat that best. The
// unlock still needs a perfect score — retakes change what XP you keep, not what
// clears the gate.
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
    const cookieValue = context.cookies.get(GUEST_SCORES_COOKIE)?.value;
    const zones = await getZones(supabase);
    const firstSlug = zones[0]?.slug;

    // The guest's per-zone best scores, held across the write below so the XP
    // total and the returned unlock set both reflect this submission. Unused when
    // authed (attempts live in `quiz_attempts`).
    const guestScores: GuestScores = user ? new Map<string, GuestScore>() : await readGuestScores(cookieValue);

    // The gate uses the DB-derived set for authed learners, the signed cookie
    // for guests — so a direct POST to a locked zone is rejected either way. The
    // same read backs the lesson/quiz gate, so the three can't disagree.
    let unlocked = await getUnlockedZonesForRequest(supabase, user?.id ?? null, cookieValue);

    if (!isZoneUnlocked(zoneSlug, firstSlug, unlocked)) {
      return Response.json({ error: "This zone is locked." }, { status: 403 });
    }

    const zone = zones.find((candidate) => candidate.slug === zoneSlug);
    const mission = zone ? await getMissionByZoneId(supabase, zone.id) : null;
    if (!mission) {
      return Response.json({ error: "Quiz not found." }, { status: 404 });
    }

    const result = await gradeQuiz(supabase, mission.id, answers);

    // This submission as a ledger entry, and what its score is worth.
    const attempt: Attempt = {
      missionId: mission.id,
      correctCount: result.correct_count,
      questionTotal: result.total,
      passed: result.passed,
    };
    const attemptXp = xpForAttempt(mission.xp_value, attempt);

    // The previous best on this mission — read *before* recording, so "is this a
    // record?" compares against the learner's history rather than itself.
    const previousBest = user
      ? await getBestAttemptForMission(supabase, user.id, mission.id)
      : guestScoreAsAttempt(mission.id, guestScores.get(zoneSlug));
    const previousXp = previousBest ? xpForAttempt(mission.xp_value, previousBest) : 0;

    const isRecord = attemptXp > previousXp;
    // The total only ever moves by the gain over the previous best, so retaking is
    // always safe: a worse attempt adds nothing, a better one adds the difference.
    const xpEarned = Math.max(0, attemptXp - previousXp);

    if (user) {
      // Authed: append the attempt, then recompute from the DB (unlocks and XP are
      // derived from the ledger, never added by hand).
      await recordAttempt(supabase, user.id, attempt);
      unlocked = await getUnlockedZoneSlugsForUser(supabase, user.id);
    } else {
      // Guest: keep only the best score per zone — a cookie is no place for a full
      // ledger, and best-of is all the derivations need.
      if (isRecord) {
        guestScores.set(zoneSlug, { correctCount: result.correct_count, questionTotal: result.total });
        await writeGuestScores(context.cookies, guestScores);
      }
      unlocked = await getUnlockedZoneSlugsForGuest(supabase, guestScores);
    }

    // The running total after any write: authed reads the ledger, guest sums the
    // (post-write) cookie scores — the same sums the map badge uses.
    const totalXp = user ? await getTotalXpForUser(supabase, user.id) : await getTotalXpForGuest(supabase, guestScores);

    // The learner's best after this submission, for the panel's "Best 2 of 3".
    // `bestXp` is computed here, not in the UI, so the scoring formula has exactly
    // one home.
    const best = isRecord ? attempt : (previousBest ?? attempt);
    const bestXp = xpForAttempt(mission.xp_value, best);

    // The client's view of "which zones are open" — the earned set plus the
    // always-free first zone. Lets the map re-render the unlock immediately.
    const effective = new Set(unlocked);
    if (firstSlug) effective.add(firstSlug);

    return Response.json({
      ...result,
      unlockedZones: [...effective],
      xpEarned,
      totalXp,
      attemptXp,
      isRecord,
      bestCorrectCount: best.correctCount,
      bestQuestionTotal: best.questionTotal,
      bestXp,
      missionXpValue: mission.xp_value,
    });
  } catch {
    return Response.json({ error: "Something went wrong grading this quiz." }, { status: 500 });
  }
};
