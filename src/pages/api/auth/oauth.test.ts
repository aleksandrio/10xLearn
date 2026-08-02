import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/pages/api/auth/oauth";
import { createClient } from "@/lib/supabase";
import { resolveSiteOrigin } from "@/lib/site-url";
import { makeContext, makeSupabaseClient, redirectLocation, TEST_ORIGIN } from "@/test/api-context";

// Locks down `POST /api/auth/oauth`, which starts the Google flow server-side.
// The branch that earns this file its keep is the fail-closed origin guard
// (oauth.ts:17-20): the callback URL must be built from the *resolved* origin, so
// a client-controlled Host header can never redirect the grant somewhere else.
// When the origin cannot be resolved the route refuses to start the flow rather
// than falling back to the request — the last test asserts the positive half of
// that, which is the part a refactor could quietly break while still passing the
// null case.

// `createClient` keeps its real implementation by default — the `astro:env/server`
// stub leaves the config empty, so unmocked it genuinely returns null.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});
// `resolveSiteOrigin` likewise keeps its real implementation: PUBLIC_SITE_URL is
// empty and `import.meta.env.PROD` is false under test, so it falls back to the
// request origin and the happy path needs no override (site-url.ts:13).
vi.mock("@/lib/site-url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/site-url")>();
  return { ...actual, resolveSiteOrigin: vi.fn(actual.resolveSiteOrigin) };
});

/** Puts the route past its null-client guard, with `auth` wired to the given fakes. */
function configured(auth: Record<string, unknown>) {
  vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/oauth", () => {
  it("redirects with a configuration error when Supabase is unavailable", async () => {
    const response = await POST(makeContext({ method: "POST" }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Supabase%20is%20not%20configured");
  });

  it("fails closed when the site origin cannot be resolved", async () => {
    const signInWithOAuth = vi.fn();
    configured({ signInWithOAuth });
    vi.mocked(resolveSiteOrigin).mockReturnValueOnce(null);

    const response = await POST(makeContext({ method: "POST" }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Sign-in%20is%20temporarily%20unavailable");
    // Refuses to start the flow at all rather than minting a request-Host URL.
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("redirects with the provider's message when the flow cannot be started", async () => {
    configured({
      signInWithOAuth: vi.fn(() => Promise.resolve({ data: { url: null }, error: { message: "Provider disabled" } })),
    });

    const response = await POST(makeContext({ method: "POST" }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Provider%20disabled");
  });

  it("redirects with a generic message when the provider returns no URL", async () => {
    // The other arm of oauth.ts:28 — no error, but nowhere to send the user.
    configured({ signInWithOAuth: vi.fn(() => Promise.resolve({ data: { url: null }, error: null })) });

    const response = await POST(makeContext({ method: "POST" }));

    expect(redirectLocation(response)).toBe("/auth/signin?error=Could%20not%20start%20Google%20sign-in");
  });

  it("sends the user to the provider, with a callback built from the resolved origin", async () => {
    const signInWithOAuth = vi.fn(() =>
      Promise.resolve({
        data: { url: "https://accounts.google.example/o/oauth2/auth?client_id=1" },
        error: null,
      }),
    );
    configured({ signInWithOAuth });
    // Deliberately different from the request's own host, so the assertion below
    // fails if the callback is ever rebuilt from `context.url` instead.
    vi.mocked(resolveSiteOrigin).mockReturnValueOnce("https://deployed.example");

    const response = await POST(makeContext({ method: "POST", url: `${TEST_ORIGIN}/api/auth/oauth` }));

    expect(redirectLocation(response)).toBe("https://accounts.google.example/o/oauth2/auth?client_id=1");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://deployed.example/api/auth/callback" },
    });
  });
});
