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
 * completions → total XP (map badge + grade response). The pure core of S-03 XP:
 * XP is never stored as a running total, it is summed on demand from the
 * completed-mission set. Sibling of `unlockedSlugsFromCompletions` — a pure
 * function of the completion set, unit-tested in isolation.
 *
 * Sums `xp_value` for each completed mission id present in `xpByMissionId`; a
 * completed id with no entry in the map contributes 0 (e.g. a mission removed
 * from content after it was cleared).
 */
export function xpFromCompletions(xpByMissionId: Map<string, number>, completedMissionIds: Set<string>): number {
  let total = 0;
  for (const missionId of completedMissionIds) {
    total += xpByMissionId.get(missionId) ?? 0;
  }
  return total;
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
 * `buildMissionIdByZone`, and the DB input to the pure `xpFromCompletions`. A
 * single `missions` query; `missions` has public read so both guest and authed
 * paths can call it.
 */
async function buildXpByMissionId(supabase: ContentClient): Promise<Map<string, number>> {
  const { data, error } = await supabase.from("missions").select("id, xp_value");
  if (error) throw error;
  return new Map(data.map((mission) => [mission.id, mission.xp_value]));
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
 * The total XP for an authenticated user, derived from their DB completions.
 * Reads `mission_completions` (RLS scopes to the caller) and the xp-value map,
 * then applies the pure `xpFromCompletions`. Idempotent by construction — the
 * total is a function of the `unique(user_id, mission_id)` set, so re-passing a
 * mission cannot inflate it.
 */
export async function getTotalXpForUser(supabase: ContentClient, userId: string): Promise<number> {
  const [completionsResult, xpByMissionId] = await Promise.all([
    supabase.from("mission_completions").select("mission_id").eq("user_id", userId),
    buildXpByMissionId(supabase),
  ]);
  if (completionsResult.error) throw completionsResult.error;

  const completedMissionIds = new Set(completionsResult.data.map((row) => row.mission_id));
  return xpFromCompletions(xpByMissionId, completedMissionIds);
}

/**
 * The total XP for a guest, derived from their signed-cookie unlocks. Reuses
 * `impliedCompletionsFromUnlocked` to turn the unlocked-slug set into the implied
 * completed-mission set, then applies the same pure sum — so guest XP needs no
 * cookie-format change and no schema of its own.
 */
export async function getGuestTotalXp(supabase: ContentClient, cookieUnlocked: Set<string>): Promise<number> {
  const zones = await getZones(supabase);
  const [missionIdByZone, xpByMissionId] = await Promise.all([
    buildMissionIdByZone(supabase, zones),
    buildXpByMissionId(supabase),
  ]);
  const completed = impliedCompletionsFromUnlocked(zones, missionIdByZone, cookieUnlocked);
  return xpFromCompletions(xpByMissionId, completed);
}

/**
 * Record that `userId` passed `missionId`. Idempotent: an upsert that ignores
 * the `(user_id, mission_id)` unique conflict, so re-recording a pass is a no-op.
 *
 * Returns whether a row was genuinely inserted (`true`) or the conflict was
 * ignored because the completion already existed (`false`). `.select("id")`
 * yields the inserted row(s) on an insert and no rows on an ignored conflict —
 * this is exactly the signal `grade.ts` needs to award the per-pass "+X XP"
 * delta only on a *new* completion (0 on a re-pass).
 */
export async function recordCompletion(supabase: ContentClient, userId: string, missionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("mission_completions")
    .upsert({ user_id: userId, mission_id: missionId }, { onConflict: "user_id,mission_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return data.length > 0;
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
