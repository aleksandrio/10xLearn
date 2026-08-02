import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/pages/api/auth/callback";
import { createClient } from "@/lib/supabase";
import { makeContext, makeSupabaseClient, redirectLocation } from "@/test/api-context";

// Locks down `GET /api/auth/callback`, the provider-agnostic OAuth completion.
// Four branches: no `?code`, unconfigured, a failed exchange, and the success
// path that hands the code to Supabase and lands on the map. Nothing here is
// Google-specific, and these tests stay that way so a second provider reuses the
// route unchanged.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

const CALLBACK_URL = "/api/auth/callback?code=grant-code-1";

/** Puts the route past its null-client guard, with `auth` wired to the given fakes. */
function configured(auth: Record<string, unknown>) {
  vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/callback", () => {
  it("redirects to sign-in when the provider sent no authorization code", async () => {
    const response = await GET(makeContext({ url: "/api/auth/callback" }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Missing%20authorization%20code");
    // The guard runs first — a codeless callback never reaches the client.
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("redirects with a configuration error when Supabase is unavailable", async () => {
    const response = await GET(makeContext({ url: CALLBACK_URL }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Supabase%20is%20not%20configured");
  });

  it("redirects with the provider's message when the code exchange fails", async () => {
    configured({ exchangeCodeForSession: vi.fn(() => Promise.resolve({ error: { message: "Invalid grant" } })) });

    const response = await GET(makeContext({ url: CALLBACK_URL }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Invalid%20grant");
  });

  it("exchanges the code and redirects to the map on success", async () => {
    const exchangeCodeForSession = vi.fn(() => Promise.resolve({ error: null }));
    configured({ exchangeCodeForSession });

    const response = await GET(makeContext({ url: CALLBACK_URL }));

    expect(redirectLocation(response)).toBe("/");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("grant-code-1");
  });
});
