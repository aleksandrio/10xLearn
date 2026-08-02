import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/pages/api/auth/reset-request";
import { createClient } from "@/lib/supabase";
import { resolveSiteOrigin } from "@/lib/site-url";
import { makeContext, makeSupabaseClient, redirectLocation } from "@/test/api-context";

// Locks down `POST /api/auth/reset-request`. Its neutral response is a security
// property, not an implementation detail: the route must land on ?sent=1 whether
// or not the address has an account, whether or not the provider is reachable,
// and whether or not the origin resolves (reset-request.ts:24-37). Any branch
// that answers differently tells an attacker which emails are registered, so the
// "even when the provider throws" test below is the most valuable assertion in
// this file — the error path is invisible in normal use and would otherwise only
// be discovered by someone probing for it.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});
// Real by default: PUBLIC_SITE_URL is empty and PROD is false under test, so it
// falls back to the request origin (site-url.ts:13) and only the null case needs
// an override.
vi.mock("@/lib/site-url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/site-url")>();
  return { ...actual, resolveSiteOrigin: vi.fn(actual.resolveSiteOrigin) };
});

const SENT = "/auth/forgot-password?sent=1";

/** Puts the route past its null-client guard, with `auth` wired to the given fakes. */
function configured(auth: Record<string, unknown>) {
  vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/reset-request", () => {
  it("rejects a missing email before building a client", async () => {
    const response = await POST(makeContext({ form: {} }));

    expect(redirectLocation(response)).toBe("/auth/forgot-password?error=Email%20is%20required");
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("rejects a blank email", async () => {
    const response = await POST(makeContext({ form: { email: "   " } }));

    expect(redirectLocation(response)).toBe("/auth/forgot-password?error=Email%20is%20required");
  });

  it("redirects back with a configuration error when Supabase is unavailable", async () => {
    const response = await POST(makeContext({ form: { email: "learner@example.com" } }));

    expect(redirectLocation(response)).toBe("/auth/forgot-password?error=Supabase%20is%20not%20configured");
  });

  it("sends the reset mail and lands on the neutral confirmation", async () => {
    const resetPasswordForEmail = vi.fn(() => Promise.resolve({ error: null }));
    configured({ resetPasswordForEmail });

    const response = await POST(
      makeContext({ url: "/api/auth/reset-request", form: { email: "learner@example.com" } }),
    );

    expect(redirectLocation(response)).toBe(SENT);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("learner@example.com", {
      redirectTo: "https://10xlearn.test/auth/update-password",
    });
  });

  it("lands on the neutral confirmation even when the provider throws", async () => {
    // The email-enumeration guard. A provider outage, a rate limit, or an
    // unknown address must all be indistinguishable from a successful send.
    configured({
      resetPasswordForEmail: vi.fn(() => Promise.reject(new Error("supabase unreachable"))),
    });

    const response = await POST(makeContext({ form: { email: "learner@example.com" } }));

    expect(redirectLocation(response)).toBe(SENT);
  });

  it("lands on the neutral confirmation when the site origin cannot be resolved", async () => {
    const resetPasswordForEmail = vi.fn(() => Promise.resolve({ error: null }));
    configured({ resetPasswordForEmail });
    vi.mocked(resolveSiteOrigin).mockReturnValueOnce(null);

    const response = await POST(makeContext({ form: { email: "learner@example.com" } }));

    expect(redirectLocation(response)).toBe(SENT);
    // No mail is sent — a reset link built from an unresolved origin is worse
    // than none — but the caller cannot tell that from the response.
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
