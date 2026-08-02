import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/pages/api/auth/signup";
import { createClient } from "@/lib/supabase";
import { makeContext, makeSupabaseClient, redirectLocation } from "@/test/api-context";

// Locks down `POST /api/auth/signup`. Same three-branch shape as signin, with the
// difference that matters: success lands on /auth/confirm-email, not the map —
// the account is not usable until the emailed link is followed.
//
// Like signin, this route does not validate its input (signup.ts:8-9), so there
// is no 400-tier case.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

const credentials = { email: "new-learner@example.com", password: "correct-horse" };

/** Puts the route past its null-client guard, with `auth` wired to the given fakes. */
function configured(auth: Record<string, unknown>) {
  vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/signup", () => {
  it("redirects back with a configuration error when Supabase is unavailable", async () => {
    const response = await POST(makeContext({ form: credentials }));

    expect(redirectLocation(response)).toBe("/auth/signup?error=Supabase%20is%20not%20configured");
  });

  it("redirects back with the provider's message when the signup is rejected", async () => {
    configured({ signUp: vi.fn(() => Promise.resolve({ error: { message: "User already registered" } })) });

    const response = await POST(makeContext({ form: credentials }));

    expect(redirectLocation(response)).toBe("/auth/signup?error=User%20already%20registered");
  });

  it("redirects to the confirm-email page on success, not to the map", async () => {
    const signUp = vi.fn(() => Promise.resolve({ error: null }));
    configured({ signUp });

    const response = await POST(makeContext({ form: credentials }));

    expect(redirectLocation(response)).toBe("/auth/confirm-email");
    expect(signUp).toHaveBeenCalledWith(credentials);
  });
});
