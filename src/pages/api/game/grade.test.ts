import { describe, it, expect } from "vitest";
import { POST } from "@/pages/api/game/grade";
import { jsonBody, makeContext } from "@/test/api-context";

// Locks down `POST /api/game/grade`'s two guards that run before any collaborator
// is reached: the JSON/schema validation (grade.ts:55-65) and the unconfigured
// 503 (grade.ts:68-71). No mocking at all — the `astro:env/server` stub leaves the
// config empty, so `createClient` really does return null here.
//
// The happy path is deliberately absent. Grading pulls in ~11 collaborators across
// content, game, guest-progress and progress (grade.ts:3-23), so a test of it
// would assert the mock graph rather than the route. Its real risk — retake XP
// arithmetic and unlock derivation — is covered as pure functions in
// src/lib/progress.test.ts, and end-to-end thereafter via /10x-e2e.

/** The smallest body that clears `bodySchema`, so the 503 case is about the client. */
const validBody = { zoneSlug: "foundations", answers: [{ question_id: "question-1", option_id: "option-1" }] };

describe("POST /api/game/grade", () => {
  it("400s when the body is not JSON", async () => {
    const response = await POST(makeContext({ method: "POST", rawBody: "not json at all" }));

    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({ error: "A JSON body is required." });
  });

  it("400s when answers is empty", async () => {
    // An empty submission is a client bug, not a zero-score attempt — it must not
    // reach the grader and bank an attempt worth nothing.
    const response = await POST(makeContext({ json: { zoneSlug: "foundations", answers: [] } }));

    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({ error: "zoneSlug and a non-empty answers array are required." });
  });

  it("400s when zoneSlug is missing", async () => {
    const response = await POST(makeContext({ json: { answers: validBody.answers } }));

    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({ error: "zoneSlug and a non-empty answers array are required." });
  });

  it("503s when Supabase is not configured", async () => {
    const response = await POST(makeContext({ json: validBody }));

    expect(response.status).toBe(503);
    expect(await jsonBody(response)).toEqual({ error: "Grading is unavailable right now." });
  });
});
