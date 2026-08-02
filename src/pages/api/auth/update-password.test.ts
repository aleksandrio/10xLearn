import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/pages/api/auth/update-password";
import { createClient } from "@/lib/supabase";
import { makeContext, makeSupabaseClient, redirectLocation } from "@/test/api-context";

// Locks down `POST /api/auth/update-password`, which completes a reset against
// the recovery session the emailed link established. Unlike signin/signup this
// route does validate its input (update-password.ts:12), so the minimum-length
// guard is a real, zero-mock branch — and the one most likely to be loosened by
// accident, since nothing in the UI depends on it.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

const TOO_SHORT_ERROR = "/auth/update-password?error=Password%20must%20be%20at%20least%206%20characters";

/** Puts the route past its null-client guard, with `auth` wired to the given fakes. */
function configured(auth: Record<string, unknown>) {
  vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/update-password", () => {
  it("rejects a password under six characters before building a client", async () => {
    // Five characters — one below the boundary, so the test fails if `<` ever
    // becomes `<=` or the constant drifts.
    const response = await POST(makeContext({ form: { password: "short" } }));

    expect(redirectLocation(response)).toBe(TOO_SHORT_ERROR);
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("redirects back with a configuration error when Supabase is unavailable", async () => {
    const response = await POST(makeContext({ form: { password: "long-enough" } }));

    expect(redirectLocation(response)).toBe("/auth/update-password?error=Supabase%20is%20not%20configured");
  });

  it("redirects back with the provider's message when the update is rejected", async () => {
    configured({ updateUser: vi.fn(() => Promise.resolve({ error: { message: "Auth session missing" } })) });

    const response = await POST(makeContext({ form: { password: "long-enough" } }));

    expect(redirectLocation(response)).toBe("/auth/update-password?error=Auth%20session%20missing");
  });

  it("sends the user to sign in with a reset marker on success", async () => {
    const updateUser = vi.fn(() => Promise.resolve({ error: null }));
    configured({ updateUser });

    const response = await POST(makeContext({ form: { password: "long-enough" } }));

    expect(redirectLocation(response)).toBe("/auth/signin?reset=1");
    expect(updateUser).toHaveBeenCalledWith({ password: "long-enough" });
  });
});
