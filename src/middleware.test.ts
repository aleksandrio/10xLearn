import { describe, it, expect, beforeEach, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { onRequest } from "@/middleware";
import { createClient } from "@/lib/supabase";
import { GUEST_SCORES_COOKIE, readGuestScores, type GuestScores } from "@/lib/guest-progress";
import { mergeGuestScoresIntoAccount } from "@/lib/progress";
import {
  asResponse,
  makeContext,
  makeSupabaseClient,
  makeUser,
  redirectLocation,
  TEST_ORIGIN,
} from "@/test/api-context";

// Locks down the four things every request passes through: the CSRF origin
// check, `locals.user` population, the guest→account merge, and the
// protected-route redirect. Two of them are here because they fail quietly:
//
//   * CSRF (middleware.ts:14-19) is a security boundary with no visible symptom
//     when it stops working — nothing in the app breaks if the check is inverted
//     or dropped, so only a test notices.
//   * the merge (middleware.ts:37-51) is deliberately fail-open, which means a
//     permanently broken merge looks exactly like a working one from the outside.
//     The test below asserts the swallow-and-continue contract directly.
//
// This is also the one file that needs the `astro:middleware` alias
// (vitest.config.ts) — the module is imported at runtime here, unlike the routes'
// type-only `astro` import.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});
// `readGuestScores` is stubbed rather than delegated: the real one uses
// `crypto.subtle`, which is not reliably present under this suite's jsdom
// environment. Nothing here needs a genuine signature check — the cookie's
// verification is the cookie module's business, not the middleware's.
// GUEST_SCORES_COOKIE stays real so the tests can't drift from the actual name.
vi.mock("@/lib/guest-progress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guest-progress")>();
  return { ...actual, readGuestScores: vi.fn(() => Promise.resolve(new Map())) };
});
vi.mock("@/lib/progress", () => ({
  mergeGuestScoresIntoAccount: vi.fn(() => Promise.resolve()),
}));

/** The downstream handler. Its body is the marker that a pass-through really happened. */
function makeNext() {
  return vi.fn(() => Promise.resolve(new Response("downstream")));
}

/** Gives the middleware a working client whose session resolves to `user`. */
function configured(user: User | null) {
  const client = makeSupabaseClient({ auth: { getUser: vi.fn(() => Promise.resolve({ data: { user } })) } });
  vi.mocked(createClient).mockReturnValueOnce(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CSRF origin check", () => {
  it("blocks a state-changing request from another origin", async () => {
    const next = makeNext();
    const result = await onRequest(makeContext({ method: "POST", headers: { origin: "https://evil.example" } }), next);

    const response = asResponse(result);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Cross-origin request blocked.");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a state-changing request from our own origin", async () => {
    const next = makeNext();
    const result = await onRequest(makeContext({ method: "POST", headers: { origin: TEST_ORIGIN } }), next);

    expect(await asResponse(result).text()).toBe("downstream");
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows a state-changing request that carries no Origin at all", async () => {
    // Documented at middleware.ts:12-13: non-browser clients send no Origin, and
    // SameSite=Lax auth cookies are the backstop for them.
    const next = makeNext();
    await onRequest(makeContext({ method: "POST" }), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("does not police GET, whatever origin it claims", async () => {
    const next = makeNext();
    await onRequest(makeContext({ method: "GET", headers: { origin: "https://evil.example" } }), next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe("locals.user", () => {
  it("is null when Supabase is not configured", async () => {
    const context = makeContext();
    await onRequest(context, makeNext());

    expect(context.locals.user).toBeNull();
  });

  it("carries the session's user when one resolves", async () => {
    const user = makeUser("learner-1");
    configured(user);

    const context = makeContext();
    await onRequest(context, makeNext());

    expect(context.locals.user).toBe(user);
  });

  it("is null when a configured client has no session", async () => {
    configured(null);

    const context = makeContext();
    await onRequest(context, makeNext());

    expect(context.locals.user).toBeNull();
  });
});

describe("guest→account merge", () => {
  const scores: GuestScores = new Map([["foundations", { correctCount: 3, questionTotal: 3 }]]);

  it("folds a guest cookie into the account and then clears it", async () => {
    const client = configured(makeUser("learner-1"));
    vi.mocked(readGuestScores).mockResolvedValueOnce(scores);

    const context = makeContext({ cookies: { [GUEST_SCORES_COOKIE]: "signed-scores" } });
    const next = makeNext();
    await onRequest(context, next);

    expect(vi.mocked(mergeGuestScoresIntoAccount)).toHaveBeenCalledWith(client, "learner-1", scores);
    // Cleared so the merge runs once, not on every subsequent authed request.
    expect(context.cookies.has(GUEST_SCORES_COOKIE)).toBe(false);
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not merge for a guest, however much progress the cookie holds", async () => {
    const context = makeContext({ cookies: { [GUEST_SCORES_COOKIE]: "signed-scores" } });
    await onRequest(context, makeNext());

    expect(vi.mocked(mergeGuestScoresIntoAccount)).not.toHaveBeenCalled();
    expect(context.cookies.has(GUEST_SCORES_COOKIE)).toBe(true);
  });

  it("fails open when the merge throws: the request continues and the cookie survives", async () => {
    // The contract at middleware.ts:44-49. A merge hiccup must never turn a page
    // load into a 500, and keeping the cookie is what lets a later request retry.
    configured(makeUser("learner-1"));
    vi.mocked(readGuestScores).mockResolvedValueOnce(scores);
    vi.mocked(mergeGuestScoresIntoAccount).mockRejectedValueOnce(new Error("merge exploded"));
    // The route logs deliberately; stub it so the expected error doesn't pollute the run.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const context = makeContext({ cookies: { [GUEST_SCORES_COOKIE]: "signed-scores" } });
    const next = makeNext();
    const result = await onRequest(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(await asResponse(result).text()).toBe("downstream");
    expect(context.cookies.has(GUEST_SCORES_COOKIE)).toBe(true);
    // Visible rather than silent — a persistently failing merge has to be findable.
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });
});

describe("protected routes", () => {
  it("sends a signed-out visitor from /dashboard to sign-in", async () => {
    const next = makeNext();
    const result = await onRequest(makeContext({ url: "/dashboard" }), next);

    expect(redirectLocation(asResponse(result))).toBe("/auth/signin");
    expect(next).not.toHaveBeenCalled();
  });

  it("lets a signed-in learner through to /dashboard", async () => {
    configured(makeUser("learner-1"));

    const next = makeNext();
    const result = await onRequest(makeContext({ url: "/dashboard" }), next);

    expect(await asResponse(result).text()).toBe("downstream");
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves unprotected routes alone for a signed-out visitor", async () => {
    const next = makeNext();
    await onRequest(makeContext({ url: "/" }), next);

    expect(next).toHaveBeenCalledOnce();
  });
});
