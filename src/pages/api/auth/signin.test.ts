import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/pages/api/auth/signin";
import { createClient } from "@/lib/supabase";
import { makeContext, makeSupabaseClient, redirectLocation } from "@/test/api-context";

// Locks down `POST /api/auth/signin` — the canonical shape the other credential
// routes repeat: unconfigured → error redirect, provider error → error redirect,
// success → home. Assertions read `Location` rather than the status code, so the
// fake context's 302 default never becomes load-bearing.
//
// There is no 400-tier case here on purpose: this route does not validate its
// input at all (signin.ts:8-9 casts `form.get("email") as string`), unlike
// reset-request and update-password. If validation is ever added, that is a
// behavior change and belongs in a new test, not a silent pass here.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

const credentials = { email: "learner@example.com", password: "correct-horse" };

/** Puts the route past its null-client guard, with `auth` wired to the given fakes. */
function configured(auth: Record<string, unknown>) {
  vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/signin", () => {
  it("redirects back with a configuration error when Supabase is unavailable", async () => {
    const response = await POST(makeContext({ form: credentials }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Supabase%20is%20not%20configured");
  });

  it("redirects back with the provider's message when the credentials are rejected", async () => {
    configured({
      signInWithPassword: vi.fn(() => Promise.resolve({ error: { message: "Invalid login credentials" } })),
    });

    const response = await POST(makeContext({ form: credentials }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Invalid%20login%20credentials");
  });

  it("redirects to the map on success, passing the submitted credentials through", async () => {
    const signInWithPassword = vi.fn(() => Promise.resolve({ error: null }));
    configured({ signInWithPassword });

    const response = await POST(makeContext({ form: credentials }));

    expect(redirectLocation(response)).toBe("/");
    expect(signInWithPassword).toHaveBeenCalledWith(credentials);
  });
});
