// Per-learner progress (S-02, extended by S-04 retakes). Owns both the *pure*
// attempt⇄unlock⇄XP derivations (the highest-risk reconciliation logic, unit-
// tested in isolation) and the DB reads/writes against `quiz_attempts`. Mirrors
// the `content.ts` convention: every DB function takes the shared `ContentClient`.
//
// Everything is derived from one immutable ledger of attempts:
//
//   attempts ──► best attempt per mission ──► XP        (xpFromAttempts)
//            └─► passed attempts           ──► unlocks  (unlockedSlugsFromCompletions)
//
// Nothing is stored as a running total, so retaking a quiz can improve a score
// without any risk of double-awarding: the total is always a function of the
// *best* attempt, and re-passing recomputes to the same number.
//
// The seam this plugs into is `@/lib/game`'s `buildMapModel(supabase, unlocked)`,
// which is source-agnostic — it takes an unlocked-slug `Set` regardless of
// whether it came from the guest cookie or from a learner's DB attempts.
//
// This module also owns the per-request earned-access gate
// (`getUnlockedZonesForRequest` / `isZoneUnlockedForRequest`), because it is the
// only layer that can see *both* sources — DB attempts and the guest cookie —
// without `@/lib/game` and this module importing each other.

import { getZones, type ContentClient, type Zone } from "@/lib/content";
import { isZoneUnlocked, nextZoneSlug } from "@/lib/game";
import { readGuestScores, type GuestScores } from "@/lib/guest-progress";

/**
 * A zone-slug → mission-id lookup in play order. `null` for zones that have no
 * mission (those contribute no attempt and gate nothing). This is the shared
 * input to the pure functions so they never touch the DB.
 */
export type MissionIdByZone = Map<string, string | null>;

/**
 * One graded submission. The score is carried with the question count it was
 * graded against, so XP stays faithful to the quiz the learner actually faced
 * even if content later changes length.
 */
export interface Attempt {
  missionId: string;
  correctCount: number;
  questionTotal: number;
  passed: boolean;
}

/**
 * completions → unlocked slugs.
 * The first zone (by play order) is always unlocked; every other zone is
 * unlocked iff the *previous* zone's mission is in the completed set.
 * Equivalently: passing `zi`'s mission unlocks `z(i+1)`.
 */
export function unlockedSlugsFromCompletions(
  zones: Zone[],
  missionIdByZone: MissionIdByZone,
  completedMissionIds: Set<string>,
): Set<string> {
  const unlocked = new Set<string>();
  if (zones.length === 0) return unlocked;

  // First zone is free, mirroring `isZoneUnlocked` in `@/lib/game`.
  unlocked.add(zones[0].slug);

  for (const zone of zones) {
    const missionId = missionIdByZone.get(zone.slug) ?? null;
    if (missionId && completedMissionIds.has(missionId)) {
      const next = nextZoneSlug(zones, zone.slug);
      if (next) unlocked.add(next);
    }
  }
  return unlocked;
}

/**
 * attempts → cleared mission ids. A mission is cleared by any *passing* attempt,
 * and `passed` is the verdict recorded at submission time — so tightening the
 * pass rule later cannot retroactively re-lock a zone someone already earned.
 */
export function completedMissionIdsFromAttempts(attempts: Attempt[]): Set<string> {
  const completed = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.passed) completed.add(attempt.missionId);
  }
  return completed;
}

/**
 * What a single attempt is worth: the mission's `xp_value` scaled by the share of
 * questions answered correctly, rounded to a whole point. A perfect attempt is
 * worth the full value; a partial one banks partial credit (S-04). Never exceeds
 * `xpValue`, and a zero-question quiz is worth nothing rather than dividing by 0.
 */
export function xpForAttempt(xpValue: number, attempt: Attempt): number {
  if (attempt.questionTotal <= 0) return 0;
  const ratio = Math.min(1, attempt.correctCount / attempt.questionTotal);
  return Math.round(xpValue * ratio);
}

/**
 * attempts → the single best attempt per mission, ranked by XP-equivalent score
 * (the correct/total ratio). This is the one definition of "your best", used for
 * both the banked XP and the "Best 2 of 3" the quiz panel shows — so the number a
 * learner sees and the number they are paid for can never diverge.
 *
 * Ties keep the earlier attempt: the record belongs to whoever set it first.
 */
export function bestAttemptByMission(attempts: Attempt[]): Map<string, Attempt> {
  const best = new Map<string, Attempt>();
  for (const attempt of attempts) {
    const incumbent = best.get(attempt.missionId);
    if (!incumbent || ratio(attempt) > ratio(incumbent)) best.set(attempt.missionId, attempt);
  }
  return best;
}

function ratio(attempt: Attempt): number {
  return attempt.questionTotal <= 0 ? 0 : attempt.correctCount / attempt.questionTotal;
}

/**
 * attempts → total XP (map badge + grade response). The pure core of XP: never a
 * stored running total, always the sum of each mission's *best* attempt. Because
 * it keys off the best rather than a count of passes, retaking a quiz can raise
 * the total but can never inflate it — the same attempt set always sums the same.
 *
 * A mission id with no entry in `xpByMissionId` contributes 0 (e.g. a mission
 * removed from content after it was attempted).
 */
export function xpFromAttempts(xpByMissionId: Map<string, number>, attempts: Attempt[]): number {
  let total = 0;
  for (const [missionId, attempt] of bestAttemptByMission(attempts)) {
    total += xpForAttempt(xpByMissionId.get(missionId) ?? 0, attempt);
  }
  return total;
}

/**
 * guest cookie scores → attempts. The cookie stores only each zone's best score
 * (a full ledger has no business in a cookie), which is exactly one attempt per
 * zone from the derivations' point of view. Zones without a mission — and slugs no
 * longer in content — drop out.
 */
export function attemptsFromGuestScores(missionIdByZone: MissionIdByZone, scores: GuestScores): Attempt[] {
  const attempts: Attempt[] = [];
  for (const [zoneSlug, score] of scores) {
    const missionId = missionIdByZone.get(zoneSlug) ?? null;
    if (!missionId) continue;
    attempts.push({
      missionId,
      correctCount: score.correctCount,
      questionTotal: score.questionTotal,
      // A guest's zone is cleared on the same strict rule as an authed learner's.
      passed: score.questionTotal > 0 && score.correctCount >= score.questionTotal,
    });
  }
  return attempts;
}

/**
 * Build the zone-slug → mission-id lookup for every zone (each zone's first
 * mission by play order). A single `missions` query — ordered by `order_index`,
 * keeping the earliest row seen per `zone_id` — rather than one query per zone.
 */
async function buildMissionIdByZone(supabase: ContentClient, zones: Zone[]): Promise<MissionIdByZone> {
  const { data, error } = await supabase
    .from("missions")
    .select("id, zone_id, order_index")
    .order("order_index", { ascending: true });
  if (error) throw error;

  const firstMissionByZoneId = new Map<string, string>();
  for (const mission of data) {
    if (!firstMissionByZoneId.has(mission.zone_id)) {
      firstMissionByZoneId.set(mission.zone_id, mission.id);
    }
  }

  return new Map(zones.map((zone) => [zone.slug, firstMissionByZoneId.get(zone.id) ?? null]));
}

/**
 * Build the mission-id → xp_value lookup — the XP-weight analogue of
 * `buildMissionIdByZone`, and the DB input to the pure XP sum. A single
 * `missions` query; `missions` has public read so both guest and authed paths can
 * call it.
 */
async function buildXpByMissionId(supabase: ContentClient): Promise<Map<string, number>> {
  const { data, error } = await supabase.from("missions").select("id, xp_value");
  if (error) throw error;
  return new Map(data.map((mission) => [mission.id, mission.xp_value]));
}

/**
 * Every attempt this learner has recorded (RLS scopes the read to the caller).
 * The raw input to every authed derivation below.
 */
export async function getAttemptsForUser(supabase: ContentClient, userId: string): Promise<Attempt[]> {
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("mission_id, correct_count, question_total, passed")
    .eq("user_id", userId);
  if (error) throw error;

  return data.map((row) => ({
    missionId: row.mission_id,
    correctCount: row.correct_count,
    questionTotal: row.question_total,
    passed: row.passed,
  }));
}

/** A learner's best attempt at one mission, or `null` if they've never tried it. */
export async function getBestAttemptForMission(
  supabase: ContentClient,
  userId: string,
  missionId: string,
): Promise<Attempt | null> {
  const attempts = await getAttemptsForUser(supabase, userId);
  return bestAttemptByMission(attempts).get(missionId) ?? null;
}

/**
 * The unlocked-zone slug set for an authenticated learner, derived from their DB
 * attempts. Feed the result to `buildMapModel` exactly as the guest set is fed.
 */
export async function getUnlockedZoneSlugsForUser(supabase: ContentClient, userId: string): Promise<Set<string>> {
  const [attempts, zones] = await Promise.all([getAttemptsForUser(supabase, userId), getZones(supabase)]);
  const missionIdByZone = await buildMissionIdByZone(supabase, zones);
  return unlockedSlugsFromCompletions(zones, missionIdByZone, completedMissionIdsFromAttempts(attempts));
}

/**
 * The total XP for an authenticated learner: the sum of their best attempt at
 * each mission. Idempotent by construction — a function of the attempt set, so
 * re-passing a mission cannot inflate it, and a better attempt raises it by
 * exactly the difference.
 */
export async function getTotalXpForUser(supabase: ContentClient, userId: string): Promise<number> {
  const [attempts, xpByMissionId] = await Promise.all([
    getAttemptsForUser(supabase, userId),
    buildXpByMissionId(supabase),
  ]);
  return xpFromAttempts(xpByMissionId, attempts);
}

/**
 * The unlocked-zone slug set for a guest, derived from the best scores their
 * signed cookie carries. Same pure derivation the authed path uses — only the
 * source of the attempts differs.
 */
export async function getUnlockedZoneSlugsForGuest(supabase: ContentClient, scores: GuestScores): Promise<Set<string>> {
  const zones = await getZones(supabase);
  const missionIdByZone = await buildMissionIdByZone(supabase, zones);
  const attempts = attemptsFromGuestScores(missionIdByZone, scores);
  return unlockedSlugsFromCompletions(zones, missionIdByZone, completedMissionIdsFromAttempts(attempts));
}

/**
 * The total XP for a guest, derived from their signed-cookie scores through the
 * same sum as the authed path. A guest and an authed learner with the same best
 * scores therefore always show the same total.
 */
export async function getTotalXpForGuest(supabase: ContentClient, scores: GuestScores): Promise<number> {
  const zones = await getZones(supabase);
  const [missionIdByZone, xpByMissionId] = await Promise.all([
    buildMissionIdByZone(supabase, zones),
    buildXpByMissionId(supabase),
  ]);
  return xpFromAttempts(xpByMissionId, attemptsFromGuestScores(missionIdByZone, scores));
}

/**
 * The unlocked-zone slug set for the *caller of a request*: derived from DB
 * attempts for an authenticated learner, from the signed cookie's scores for a
 * guest. One place decides which source is authoritative, so a lesson read, a
 * quiz read and a grade submission can never disagree about which zones are open.
 * Both sets already carry the always-free first zone.
 */
export async function getUnlockedZonesForRequest(
  supabase: ContentClient,
  userId: string | null,
  cookieValue: string | undefined,
): Promise<Set<string>> {
  if (userId) return getUnlockedZoneSlugsForUser(supabase, userId);
  return getUnlockedZoneSlugsForGuest(supabase, await readGuestScores(cookieValue));
}

/**
 * The XP total for the caller of a request — the XP sibling of
 * `getUnlockedZonesForRequest`, so a page renders the badge and the map from the
 * same notion of who is asking.
 */
export async function getTotalXpForRequest(
  supabase: ContentClient,
  userId: string | null,
  cookieValue: string | undefined,
): Promise<number> {
  if (userId) return getTotalXpForUser(supabase, userId);
  return getTotalXpForGuest(supabase, await readGuestScores(cookieValue));
}

/**
 * The earned-access gate every content endpoint re-checks: is `zoneSlug` open to
 * this caller? Pass `context.locals.user?.id ?? null` and the guest cookie — an
 * authed learner is judged by their DB attempts (their cookie is cleared at the
 * guest→account merge), a guest by their signed cookie. A direct API call to a
 * locked zone is rejected on either path.
 */
export async function isZoneUnlockedForRequest(
  supabase: ContentClient,
  userId: string | null,
  cookieValue: string | undefined,
  zoneSlug: string,
): Promise<boolean> {
  const [unlocked, zones] = await Promise.all([
    getUnlockedZonesForRequest(supabase, userId, cookieValue),
    getZones(supabase),
  ]);
  return isZoneUnlocked(zoneSlug, zones[0]?.slug, unlocked);
}

/**
 * Append a graded submission to the ledger. Every attempt is recorded — a fail
 * banks its partial credit just as a pass does — and nothing is ever updated, so
 * two concurrent submissions cannot race each other's score.
 */
export async function recordAttempt(supabase: ContentClient, userId: string, attempt: Attempt): Promise<void> {
  const { error } = await supabase.from("quiz_attempts").insert({
    user_id: userId,
    mission_id: attempt.missionId,
    correct_count: attempt.correctCount,
    question_total: attempt.questionTotal,
    passed: attempt.passed,
  });
  if (error) throw error;
}

/**
 * Fold a guest's in-session scores (from the signed cookie) forward into a newly
 * authenticated account, as one recorded attempt per zone they scored on.
 *
 * Monotonic rather than idempotent-by-key: the ledger has no unique constraint to
 * conflict on, so re-running would append duplicate rows. Harmless to the derived
 * totals (best-of ignores duplicates) but pointless, so the middleware clears the
 * cookie immediately after — and we skip zones the account already scored at least
 * as well on, which keeps a retried merge from padding the ledger.
 */
export async function mergeGuestScoresIntoAccount(
  supabase: ContentClient,
  userId: string,
  scores: GuestScores,
): Promise<void> {
  const zones = await getZones(supabase);
  const missionIdByZone = await buildMissionIdByZone(supabase, zones);
  const guestAttempts = attemptsFromGuestScores(missionIdByZone, scores);
  if (guestAttempts.length === 0) return;

  const existingBest = bestAttemptByMission(await getAttemptsForUser(supabase, userId));
  const worthKeeping = guestAttempts.filter((attempt) => {
    const incumbent = existingBest.get(attempt.missionId);
    return !incumbent || ratio(attempt) > ratio(incumbent);
  });
  if (worthKeeping.length === 0) return;

  const { error } = await supabase.from("quiz_attempts").insert(
    worthKeeping.map((attempt) => ({
      user_id: userId,
      mission_id: attempt.missionId,
      correct_count: attempt.correctCount,
      question_total: attempt.questionTotal,
      passed: attempt.passed,
    })),
  );
  if (error) throw error;
}
