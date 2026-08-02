import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/pages/api/game/lesson";
import { createClient } from "@/lib/supabase";
import { getMissionByZone, type Lesson, type MissionWithLesson } from "@/lib/content";
import { isZoneUnlockedForRequest } from "@/lib/progress";
import { GUEST_SCORES_COOKIE } from "@/lib/guest-progress";
import { jsonBody, makeContext, makeSupabaseClient, makeUser } from "@/test/api-context";

// Locks down `GET /api/game/lesson`'s response contract. Same branch set as the
// quiz route, with one difference that is the reason this file exists rather than
// being a copy: the 404 is driven by `!mission?.lesson` (lesson.ts:36), so a
// mission that exists with no lesson attached must still 404 rather than return a
// half-empty payload.
//
// The 403 is the earned-access rule enforced server-side, which is what makes a
// direct call to a locked zone fail regardless of what the UI renders.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});
vi.mock("@/lib/content", () => ({
  getMissionByZone: vi.fn(),
}));
vi.mock("@/lib/progress", () => ({
  isZoneUnlockedForRequest: vi.fn(),
}));

const lesson: Lesson = {
  id: "lesson-1",
  mission_id: "mission-1",
  title: "What agents are",
  body: "# Agents\n\nA loop that plans and acts.",
};

/** A mission row as `getMissionByZone` returns it — lessonless unless asked. */
function mission(overrides: Partial<MissionWithLesson> = {}): MissionWithLesson {
  return {
    id: "mission-1",
    zone_id: "zone-1",
    slug: "foundations",
    title: "Foundations",
    order_index: 0,
    xp_value: 10,
    lesson: null,
    ...overrides,
  };
}

const LESSON_URL = "/api/game/lesson?zoneSlug=foundations";

/** Puts the route past its null-client guard for this one call. */
function configured() {
  const client = makeSupabaseClient();
  vi.mocked(createClient).mockReturnValueOnce(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/game/lesson", () => {
  it("400s when zoneSlug is missing", async () => {
    const response = await GET(makeContext({ url: "/api/game/lesson" }));

    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({ error: "A zoneSlug query parameter is required." });
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("503s when Supabase is not configured", async () => {
    const response = await GET(makeContext({ url: LESSON_URL }));

    expect(response.status).toBe(503);
    expect(await jsonBody(response)).toEqual({ error: "Content is unavailable right now." });
  });

  it("403s for a guest whose zone is locked, gating on the guest cookie", async () => {
    const client = configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(false);

    const response = await GET(makeContext({ url: LESSON_URL, cookies: { [GUEST_SCORES_COOKIE]: "signed-scores" } }));

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toEqual({ error: "This zone is locked." });
    expect(vi.mocked(isZoneUnlockedForRequest)).toHaveBeenCalledWith(client, null, "signed-scores", "foundations");
  });

  it("403s for an authed learner whose zone is locked, gating on their user id", async () => {
    const client = configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(false);

    const response = await GET(makeContext({ url: LESSON_URL, user: makeUser("learner-1") }));

    expect(response.status).toBe(403);
    expect(vi.mocked(isZoneUnlockedForRequest)).toHaveBeenCalledWith(client, "learner-1", undefined, "foundations");
  });

  it("404s when the unlocked zone has no mission", async () => {
    configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(true);
    vi.mocked(getMissionByZone).mockResolvedValue(null);

    const response = await GET(makeContext({ url: LESSON_URL }));

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Lesson not found." });
  });

  it("404s when the mission exists but carries no lesson", async () => {
    // The branch that distinguishes this route from the quiz one: content can be
    // half-authored, and a mission without a lesson is a 404, not a 200 with null.
    configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(true);
    vi.mocked(getMissionByZone).mockResolvedValue(mission({ lesson: null }));

    const response = await GET(makeContext({ url: LESSON_URL }));

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Lesson not found." });
  });

  it("returns the mission and its lesson when the zone is unlocked", async () => {
    configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(true);
    vi.mocked(getMissionByZone).mockResolvedValue(mission({ lesson }));

    const response = await GET(makeContext({ url: LESSON_URL, user: makeUser() }));

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      mission: { id: "mission-1", title: "Foundations", slug: "foundations" },
      lesson,
    });
  });
});
