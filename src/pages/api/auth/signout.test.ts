import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/pages/api/auth/signout";
import { createClient } from "@/lib/supabase";
import { makeContext, makeSupabaseClient, redirectLocation } from "@/test/api-context";

// Locks down `POST /api/auth/signout`, whose whole contract is that it always
// lands on the map (signout.ts:8-11). Signing out of a misconfigured deployment
// still has to feel like signing out — a missing client must never become an
// error page, because there is nothing the user could do about it and nothing to
// protect. That property is easy to lose in a refactor, hence the first test.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/signout", () => {
  it("redirects to the map even when Supabase is not configured", async () => {
    const response = await POST(makeContext({ method: "POST" }));

    expect(redirectLocation(response)).toBe("/");
  });

  it("signs the session out and redirects to the map when configured", async () => {
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth: { signOut } }));

    const response = await POST(makeContext({ method: "POST" }));

    expect(redirectLocation(response)).toBe("/");
    expect(signOut).toHaveBeenCalledOnce();
  });
});
