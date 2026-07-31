import { describe, it, expect } from "vitest";
import { unlockedSlugsFromCompletions, impliedCompletionsFromUnlocked, type MissionIdByZone } from "@/lib/progress";
import type { Zone } from "@/lib/content";

// Locks down the completion⇄unlock derivation — the highest-risk reconciliation
// logic. Pure functions over (zonesInOrder, missionIdByZone, set), no DB.

function zone(slug: string, order_index: number): Zone {
  return { id: `zone-${slug}`, slug, title: slug, description: null, order_index };
}

// Three zones in play order, each with a mission.
const zones: Zone[] = [zone("z0", 0), zone("z1", 1), zone("z2", 2)];
const missionIdByZone: MissionIdByZone = new Map([
  ["z0", "m0"],
  ["z1", "m1"],
  ["z2", "m2"],
]);

describe("unlockedSlugsFromCompletions", () => {
  it("returns only the first zone when nothing is completed", () => {
    expect(unlockedSlugsFromCompletions(zones, missionIdByZone, new Set())).toEqual(new Set(["z0"]));
  });

  it("unlocks the second zone once the first mission is completed", () => {
    expect(unlockedSlugsFromCompletions(zones, missionIdByZone, new Set(["m0"]))).toEqual(new Set(["z0", "z1"]));
  });

  it("unlocks every zone when every gating mission is completed", () => {
    expect(unlockedSlugsFromCompletions(zones, missionIdByZone, new Set(["m0", "m1"]))).toEqual(
      new Set(["z0", "z1", "z2"]),
    );
  });

  it("returns an empty set for no zones", () => {
    expect(unlockedSlugsFromCompletions([], new Map(), new Set(["m0"]))).toEqual(new Set());
  });
});

describe("impliedCompletionsFromUnlocked", () => {
  it("implies no completion from the first zone alone (frontier contributes nothing)", () => {
    expect(impliedCompletionsFromUnlocked(zones, missionIdByZone, new Set(["z0"]))).toEqual(new Set());
  });

  it("implies the first mission when the second zone is unlocked", () => {
    // z1 is the frontier here — it contributes no completion of its own.
    expect(impliedCompletionsFromUnlocked(zones, missionIdByZone, new Set(["z0", "z1"]))).toEqual(new Set(["m0"]));
  });

  it("implies all but the frontier mission when every zone is unlocked", () => {
    expect(impliedCompletionsFromUnlocked(zones, missionIdByZone, new Set(["z0", "z1", "z2"]))).toEqual(
      new Set(["m0", "m1"]),
    );
  });
});

describe("round-trip stability", () => {
  it("unlocked → implied completions → unlocked is stable", () => {
    const unlocked = new Set(["z0", "z1"]);
    const implied = impliedCompletionsFromUnlocked(zones, missionIdByZone, unlocked);
    expect(unlockedSlugsFromCompletions(zones, missionIdByZone, implied)).toEqual(unlocked);
  });
});

describe("zones without a mission", () => {
  // z1 has no mission: it can be unlocked, but gates nothing and contributes no
  // completion. z2 therefore stays locked even when z1 is unlocked.
  const missionless: MissionIdByZone = new Map([
    ["z0", "m0"],
    ["z1", null],
    ["z2", "m2"],
  ]);

  it("skips a missionless zone when deriving unlocks (does not unlock past it)", () => {
    expect(unlockedSlugsFromCompletions(zones, missionless, new Set(["m0"]))).toEqual(new Set(["z0", "z1"]));
  });

  it("skips a missionless zone when deriving implied completions", () => {
    expect(impliedCompletionsFromUnlocked(zones, missionless, new Set(["z0", "z1", "z2"]))).toEqual(new Set(["m0"]));
  });
});
