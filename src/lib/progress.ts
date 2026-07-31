// Per-user progress (S-02). Owns both the *pure* completion⇄unlock derivation
// (the highest-risk reconciliation logic, unit-tested in isolation) and the DB
// reads/writes against `mission_completions`. Mirrors the `content.ts`
// convention: every DB function takes the shared `ContentClient`.
//
// The seam this plugs into is `@/lib/game`'s `buildMapModel(supabase, unlocked)`,
// which is source-agnostic — it takes an unlocked-slug `Set` regardless of
// whether it came from the guest cookie or from a user's DB completions. So the
// DB path here only needs to *produce that set*; map assembly is reused verbatim.

import { getZones, type ContentClient, type Zone } from "@/lib/content";
import { nextZoneSlug } from "@/lib/game";

/**
 * A zone-slug → mission-id lookup in play order. `null` for zones that have no
 * mission (those contribute no completion and gate nothing). This is the shared
 * input to both pure functions so they never touch the DB.
 */
export type MissionIdByZone = Map<string, string | null>;

/**
 * completions → unlocked slugs (map render for authed users).
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
 * cookie unlocked-slugs → implied completions (used by the merge).
 * For each zone `zi`, if `nextZone(zi)` is in the unlocked set then `zi`'s
 * mission must have been passed → mark it completed. The frontier unlocked zone
 * itself contributes no completion (it may be unlocked but not yet passed), and
 * zones without a mission are skipped.
 */
export function impliedCompletionsFromUnlocked(
  zones: Zone[],
  missionIdByZone: MissionIdByZone,
  unlockedSlugs: Set<string>,
): Set<string> {
  const completed = new Set<string>();
  for (const zone of zones) {
    const missionId = missionIdByZone.get(zone.slug) ?? null;
    if (!missionId) continue;
    const next = nextZoneSlug(zones, zone.slug);
    if (next && unlockedSlugs.has(next)) completed.add(missionId);
  }
  return completed;
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
 * The unlocked-zone slug set for an authenticated user, derived from their DB
 * completions. Reads `mission_completions` (RLS scopes to the caller), joins the
 * play-order zone list, and applies the pure derivation. Feed the result to
 * `buildMapModel` exactly as the guest cookie set is fed.
 */
export async function getUnlockedZoneSlugsForUser(supabase: ContentClient, userId: string): Promise<Set<string>> {
  const [completionsResult, zones] = await Promise.all([
    supabase.from("mission_completions").select("mission_id").eq("user_id", userId),
    getZones(supabase),
  ]);
  if (completionsResult.error) throw completionsResult.error;

  const completedMissionIds = new Set(completionsResult.data.map((row) => row.mission_id));
  const missionIdByZone = await buildMissionIdByZone(supabase, zones);
  return unlockedSlugsFromCompletions(zones, missionIdByZone, completedMissionIds);
}

/**
 * Record that `userId` passed `missionId`. Idempotent: an upsert that ignores
 * the `(user_id, mission_id)` unique conflict, so re-recording a pass is a no-op.
 */
export async function recordCompletion(supabase: ContentClient, userId: string, missionId: string): Promise<void> {
  const { error } = await supabase
    .from("mission_completions")
    .upsert({ user_id: userId, mission_id: missionId }, { onConflict: "user_id,mission_id", ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Fold a guest's in-session unlocks (from the signed cookie) forward into a
 * newly authenticated account: translate the unlocked-slug set into the implied
 * set of passed missions and upsert them. Idempotent and monotonic (union of
 * completion sets) — safe to re-run, so the middleware merge that calls this can
 * fire on every request until the cookie is cleared.
 */
export async function mergeGuestUnlocksIntoAccount(
  supabase: ContentClient,
  userId: string,
  cookieUnlocked: Set<string>,
): Promise<void> {
  const zones = await getZones(supabase);
  const missionIdByZone = await buildMissionIdByZone(supabase, zones);
  const impliedCompletions = impliedCompletionsFromUnlocked(zones, missionIdByZone, cookieUnlocked);
  if (impliedCompletions.size === 0) return;

  const rows = [...impliedCompletions].map((missionId) => ({ user_id: userId, mission_id: missionId }));
  const { error } = await supabase
    .from("mission_completions")
    .upsert(rows, { onConflict: "user_id,mission_id", ignoreDuplicates: true });
  if (error) throw error;
}
