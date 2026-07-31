// Map model assembly (S-01). Turns the typed content layer (`@/lib/content`)
// plus a guest's unlocked-slug set into the shape the `WorldMap` island renders,
// and owns the DB-aware unlock rules the game endpoints reuse.
//
// The "first zone is always unlocked" default lives here (not in the cookie
// helper) because only this layer knows the play order (`order_index`). The
// cookie carries only the zones a guest has *earned* beyond the first.

import { getZones, getMissionByZoneId, type ContentClient, type Zone } from "@/lib/content";
import { readUnlockedZones } from "@/lib/guest-progress";

export type CheckpointType = "lesson" | "quiz";

export interface MapCheckpoint {
  type: CheckpointType;
  title: string;
}

export interface MapZone {
  slug: string;
  title: string;
  order_index: number;
  locked: boolean;
  mission: { id: string; title: string } | null;
  checkpoints: MapCheckpoint[];
}

/**
 * Whether a zone is unlocked for a guest: the first zone (by play order) is
 * always free; every other zone must be present in the guest's unlocked set.
 */
export function isZoneUnlocked(slug: string, firstSlug: string | undefined, unlocked: Set<string>): boolean {
  return slug === firstSlug || unlocked.has(slug);
}

/**
 * The single source of truth for the earned-access gate: verify the guest's
 * signed cookie and decide whether `zoneSlug` is unlocked (first zone is always
 * free). Every game endpoint re-checks here, so a direct API call to a locked
 * zone can't bypass the gate.
 */
export async function isZoneUnlockedByCookie(
  supabase: ContentClient,
  cookieValue: string | undefined,
  zoneSlug: string,
): Promise<boolean> {
  const [unlocked, zones] = await Promise.all([readUnlockedZones(cookieValue), getZones(supabase)]);
  return isZoneUnlocked(zoneSlug, zones[0]?.slug, unlocked);
}

/** The slug of the zone immediately after `currentSlug` in play order, or null. Used by Phase 3. */
export function nextZoneSlug(zones: Zone[], currentSlug: string): string | null {
  const index = zones.findIndex((zone) => zone.slug === currentSlug);
  if (index === -1 || index + 1 >= zones.length) return null;
  return zones[index + 1].slug;
}

/**
 * Build the world-map model in play order: every zone annotated with its
 * mission, a lesson checkpoint and a quiz checkpoint, and a `locked` flag
 * derived from the guest's unlocked set.
 */
export async function buildMapModel(supabase: ContentClient, unlocked: Set<string>): Promise<MapZone[]> {
  const zones = await getZones(supabase);
  const firstSlug = zones[0]?.slug;

  return Promise.all(
    zones.map(async (zone): Promise<MapZone> => {
      const mission = await getMissionByZoneId(supabase, zone.id);
      return {
        slug: zone.slug,
        title: zone.title,
        order_index: zone.order_index,
        locked: !isZoneUnlocked(zone.slug, firstSlug, unlocked),
        mission: mission ? { id: mission.id, title: mission.title } : null,
        checkpoints: [
          { type: "lesson", title: mission?.lesson?.title ?? "Lesson" },
          { type: "quiz", title: mission ? `${mission.title} quiz` : "Quiz" },
        ],
      };
    }),
  );
}
