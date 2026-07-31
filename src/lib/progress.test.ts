import { describe, it, expect } from "vitest";
import {
  unlockedSlugsFromCompletions,
  completedMissionIdsFromAttempts,
  bestAttemptByMission,
  attemptsFromGuestScores,
  xpForAttempt,
  xpFromAttempts,
  type Attempt,
  type MissionIdByZone,
} from "@/lib/progress";
import type { GuestScores } from "@/lib/guest-progress";
import type { Zone } from "@/lib/content";

// Locks down the attempt⇄unlock⇄XP derivations — the highest-risk reconciliation
// logic. Pure functions over (zonesInOrder, missionIdByZone, attempts), no DB.

function zone(slug: string, order_index: number): Zone {
  return { id: `zone-${slug}`, slug, title: slug, description: null, order_index };
}

/** An attempt against a 3-question quiz; `passed` follows the strict all-correct gate. */
function attempt(missionId: string, correctCount: number, questionTotal = 3): Attempt {
  return { missionId, correctCount, questionTotal, passed: correctCount >= questionTotal };
}

// Three zones in play order, each with a mission.
const zones: Zone[] = [zone("z0", 0), zone("z1", 1), zone("z2", 2)];
const missionIdByZone: MissionIdByZone = new Map([
  ["z0", "m0"],
  ["z1", "m1"],
  ["z2", "m2"],
]);

// Escalating per-mission weights, mirroring the seed (foundations=10,
// context-and-agents=20). m2 gives a third value to prove summing, not doubling.
const xpByMissionId = new Map([
  ["m0", 10],
  ["m1", 20],
  ["m2", 30],
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

describe("completedMissionIdsFromAttempts", () => {
  it("counts only passing attempts", () => {
    expect(completedMissionIdsFromAttempts([attempt("m0", 3), attempt("m1", 2)])).toEqual(new Set(["m0"]));
  });

  it("treats a mission as cleared once, however many times it was passed", () => {
    expect(completedMissionIdsFromAttempts([attempt("m0", 3), attempt("m0", 3)])).toEqual(new Set(["m0"]));
  });

  it("keeps a zone earned even after a later worse attempt", () => {
    // Retaking and doing badly must never re-lock what was already opened.
    expect(completedMissionIdsFromAttempts([attempt("m0", 3), attempt("m0", 1)])).toEqual(new Set(["m0"]));
  });

  it("honours the recorded verdict over re-deriving it", () => {
    // A pass banked under an older, looser rule stays a pass.
    const legacy: Attempt = { missionId: "m0", correctCount: 2, questionTotal: 3, passed: true };
    expect(completedMissionIdsFromAttempts([legacy])).toEqual(new Set(["m0"]));
  });

  it("returns nothing for no attempts", () => {
    expect(completedMissionIdsFromAttempts([])).toEqual(new Set());
  });
});

describe("xpForAttempt", () => {
  it("pays the full value for a perfect attempt", () => {
    expect(xpForAttempt(10, attempt("m0", 3))).toBe(10);
    expect(xpForAttempt(20, attempt("m1", 3))).toBe(20);
  });

  it("pays partial credit in proportion to the score", () => {
    expect(xpForAttempt(10, attempt("m0", 2))).toBe(7); // 6.67 → 7
    expect(xpForAttempt(10, attempt("m0", 1))).toBe(3); // 3.33 → 3
    expect(xpForAttempt(20, attempt("m1", 2))).toBe(13); // 13.33 → 13
  });

  it("pays nothing for a zero score", () => {
    expect(xpForAttempt(10, attempt("m0", 0))).toBe(0);
  });

  it("never exceeds the mission value, even on a malformed score", () => {
    expect(xpForAttempt(10, { missionId: "m0", correctCount: 9, questionTotal: 3, passed: true })).toBe(10);
  });

  it("pays nothing for a quiz with no questions rather than dividing by zero", () => {
    expect(xpForAttempt(10, { missionId: "m0", correctCount: 0, questionTotal: 0, passed: false })).toBe(0);
  });
});

describe("bestAttemptByMission", () => {
  it("keeps the highest-scoring attempt per mission", () => {
    const best = bestAttemptByMission([attempt("m0", 1), attempt("m0", 3), attempt("m0", 2)]);
    expect(best.get("m0")?.correctCount).toBe(3);
  });

  it("is unaffected by the order attempts arrive in", () => {
    const ascending = bestAttemptByMission([attempt("m0", 1), attempt("m0", 3)]);
    const descending = bestAttemptByMission([attempt("m0", 3), attempt("m0", 1)]);
    expect(ascending.get("m0")?.correctCount).toBe(descending.get("m0")?.correctCount);
  });

  it("ranks by ratio, not raw count, when quiz lengths differ", () => {
    // 2/3 beats 3/5 — the same number of wrong answers over a shorter quiz.
    const best = bestAttemptByMission([attempt("m0", 3, 5), attempt("m0", 2, 3)]);
    expect(best.get("m0")).toMatchObject({ correctCount: 2, questionTotal: 3 });
  });

  it("tracks each mission independently", () => {
    const best = bestAttemptByMission([attempt("m0", 3), attempt("m1", 1)]);
    expect(best.get("m0")?.correctCount).toBe(3);
    expect(best.get("m1")?.correctCount).toBe(1);
  });
});

describe("xpFromAttempts", () => {
  it("is 0 with no attempts", () => {
    expect(xpFromAttempts(xpByMissionId, [])).toBe(0);
  });

  it("banks partial credit from a failed attempt", () => {
    expect(xpFromAttempts(xpByMissionId, [attempt("m0", 2)])).toBe(7);
  });

  it("pays only the best attempt, never the sum of tries", () => {
    // The whole point of retakes: three attempts at m0 are worth m0's best, not 3×.
    expect(xpFromAttempts(xpByMissionId, [attempt("m0", 1), attempt("m0", 2), attempt("m0", 3)])).toBe(10);
  });

  it("does not drop back when a later attempt is worse", () => {
    expect(xpFromAttempts(xpByMissionId, [attempt("m0", 3), attempt("m0", 1)])).toBe(10);
  });

  it("rises by exactly the gain when a score improves", () => {
    const before = xpFromAttempts(xpByMissionId, [attempt("m0", 2)]);
    const after = xpFromAttempts(xpByMissionId, [attempt("m0", 2), attempt("m0", 3)]);
    expect(before).toBe(7);
    expect(after - before).toBe(3);
  });

  it("sums across missions, weighting each by its own value", () => {
    expect(xpFromAttempts(xpByMissionId, [attempt("m0", 3), attempt("m1", 3), attempt("m2", 3)])).toBe(60);
    expect(xpFromAttempts(xpByMissionId, [attempt("m0", 2), attempt("m1", 2)])).toBe(20); // 7 + 13
  });

  it("contributes 0 for a mission absent from the xp map", () => {
    expect(xpFromAttempts(xpByMissionId, [attempt("m0", 3), attempt("ghost", 3)])).toBe(10);
  });

  it("is idempotent — re-passing recomputes the same total", () => {
    const once = xpFromAttempts(xpByMissionId, [attempt("m0", 3)]);
    const twice = xpFromAttempts(xpByMissionId, [attempt("m0", 3), attempt("m0", 3)]);
    expect(twice).toBe(once);
  });
});

describe("attemptsFromGuestScores", () => {
  const scores: GuestScores = new Map([
    ["z0", { correctCount: 3, questionTotal: 3 }],
    ["z1", { correctCount: 2, questionTotal: 3 }],
  ]);

  it("maps each zone's score onto its mission", () => {
    expect(attemptsFromGuestScores(missionIdByZone, scores)).toEqual([
      { missionId: "m0", correctCount: 3, questionTotal: 3, passed: true },
      { missionId: "m1", correctCount: 2, questionTotal: 3, passed: false },
    ]);
  });

  it("applies the same strict pass rule as the authed path", () => {
    const partial: GuestScores = new Map([["z0", { correctCount: 2, questionTotal: 3 }]]);
    expect(completedMissionIdsFromAttempts(attemptsFromGuestScores(missionIdByZone, partial))).toEqual(new Set());
  });

  it("drops zones that are no longer in content", () => {
    const stale: GuestScores = new Map([["ghost-zone", { correctCount: 3, questionTotal: 3 }]]);
    expect(attemptsFromGuestScores(missionIdByZone, stale)).toEqual([]);
  });

  it("scores the FINAL zone like any other — it banks XP despite unlocking nothing", () => {
    const finalOnly: GuestScores = new Map([["z2", { correctCount: 3, questionTotal: 3 }]]);
    expect(xpFromAttempts(xpByMissionId, attemptsFromGuestScores(missionIdByZone, finalOnly))).toBe(30);
  });
});

describe("guest ⇄ authed parity", () => {
  it("gives a guest and an authed learner the same XP for the same scores", () => {
    const guest: GuestScores = new Map([
      ["z0", { correctCount: 3, questionTotal: 3 }],
      ["z1", { correctCount: 2, questionTotal: 3 }],
    ]);
    const guestXp = xpFromAttempts(xpByMissionId, attemptsFromGuestScores(missionIdByZone, guest));
    const authedXp = xpFromAttempts(xpByMissionId, [attempt("m0", 3), attempt("m1", 2)]);
    expect(guestXp).toBe(authedXp);
    expect(guestXp).toBe(23); // 10 (3/3 of 10) + 13 (2/3 of 20)
  });

  it("gives them the same unlocks for the same scores", () => {
    const guest: GuestScores = new Map([["z0", { correctCount: 3, questionTotal: 3 }]]);
    const fromGuest = unlockedSlugsFromCompletions(
      zones,
      missionIdByZone,
      completedMissionIdsFromAttempts(attemptsFromGuestScores(missionIdByZone, guest)),
    );
    const fromAuthed = unlockedSlugsFromCompletions(
      zones,
      missionIdByZone,
      completedMissionIdsFromAttempts([attempt("m0", 3)]),
    );
    expect(fromGuest).toEqual(fromAuthed);
    expect(fromGuest).toEqual(new Set(["z0", "z1"]));
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

  it("contributes no attempt for a completed missionless zone", () => {
    const scores: GuestScores = new Map([["z1", { correctCount: 3, questionTotal: 3 }]]);
    expect(attemptsFromGuestScores(missionless, scores)).toEqual([]);
  });
});
