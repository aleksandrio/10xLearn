import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/pages/api/game/quiz";
import { createClient } from "@/lib/supabase";
import { getMissionByZone, getQuizQuestions, type MissionWithLesson, type QuizQuestion } from "@/lib/content";
import { isZoneUnlockedForRequest } from "@/lib/progress";
import { GUEST_SCORES_COOKIE } from "@/lib/guest-progress";
import { jsonBody, makeContext, makeSupabaseClient, makeUser } from "@/test/api-context";

// Locks down `GET /api/game/quiz`'s response contract: the zoneSlug guard, the
// unconfigured 503, and the locked / not-found / found branch set — in both arms
// of the `locals.user` split (quiz.ts:29). The route is thin (validate → client →
// gate → fetch → respond), so these assert wiring and status codes; the
// derivations behind `isZoneUnlockedForRequest` belong to src/lib/progress.test.ts.

// `createClient` keeps its real implementation by default. The `astro:env/server`
// stub leaves SUPABASE_URL/KEY empty, so unmocked it genuinely returns null and
// the unconfigured branch is exercised against production code, not a mock.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});
vi.mock("@/lib/content", () => ({
  getMissionByZone: vi.fn(),
  getQuizQuestions: vi.fn(),
}));
vi.mock("@/lib/progress", () => ({
  isZoneUnlockedForRequest: vi.fn(),
}));

/** A mission row as `getMissionByZone` returns it. Quiz ignores `lesson`. */
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

// One question is enough — the route passes the array through untouched, so its
// length proves nothing that its identity doesn't.
const questions: QuizQuestion[] = [
  {
    id: "question-1",
    mission_id: "mission-1",
    order_index: 0,
    prompt: "What does an agent loop do?",
    options: [
      { id: "option-1", text: "Plans and acts" },
      { id: "option-2", text: "Nothing" },
    ],
  },
];

const QUIZ_URL = "/api/game/quiz?zoneSlug=foundations";

/** Puts the route past its null-client guard for this one call. */
function configured() {
  const client = makeSupabaseClient();
  vi.mocked(createClient).mockReturnValueOnce(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/game/quiz", () => {
  it("400s when zoneSlug is missing", async () => {
    const response = await GET(makeContext({ url: "/api/game/quiz" }));

    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({ error: "A zoneSlug query parameter is required." });
    // The guard runs before anything else — no client is built for a bad request.
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("503s when Supabase is not configured", async () => {
    const response = await GET(makeContext({ url: QUIZ_URL }));

    expect(response.status).toBe(503);
    expect(await jsonBody(response)).toEqual({ error: "Content is unavailable right now." });
  });

  it("403s for a guest whose zone is locked, gating on the guest cookie", async () => {
    const client = configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(false);

    const response = await GET(makeContext({ url: QUIZ_URL, cookies: { [GUEST_SCORES_COOKIE]: "signed-scores" } }));

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toEqual({ error: "This zone is locked." });
    expect(vi.mocked(isZoneUnlockedForRequest)).toHaveBeenCalledWith(client, null, "signed-scores", "foundations");
  });

  it("403s for an authed learner whose zone is locked, gating on their user id", async () => {
    const client = configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(false);

    const response = await GET(makeContext({ url: QUIZ_URL, user: makeUser("learner-1") }));

    expect(response.status).toBe(403);
    expect(vi.mocked(isZoneUnlockedForRequest)).toHaveBeenCalledWith(client, "learner-1", undefined, "foundations");
  });

  it("404s when the unlocked zone has no mission", async () => {
    configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(true);
    vi.mocked(getMissionByZone).mockResolvedValue(null);

    const response = await GET(makeContext({ url: QUIZ_URL }));

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: "Quiz not found." });
  });

  it("returns the mission and its questions when the zone is unlocked", async () => {
    configured();
    vi.mocked(isZoneUnlockedForRequest).mockResolvedValue(true);
    vi.mocked(getMissionByZone).mockResolvedValue(mission());
    vi.mocked(getQuizQuestions).mockResolvedValue(questions);

    const response = await GET(makeContext({ url: QUIZ_URL, user: makeUser() }));

    expect(response.status).toBe(200);
    // Only id/title/slug of the mission cross the wire — xp_value and zone_id stay server-side.
    expect(await jsonBody(response)).toEqual({
      mission: { id: "mission-1", title: "Foundations", slug: "foundations" },
      questions,
    });
  });
});
