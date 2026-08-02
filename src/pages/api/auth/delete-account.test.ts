import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/pages/api/auth/delete-account";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import { makeAdminClient, makeContext, makeSupabaseClient, makeUser, redirectLocation } from "@/test/api-context";

// Locks down `POST /api/auth/delete-account`, the one route that reaches for the
// service-role client. Two things are worth the file on their own:
//
//   * the auth guard (delete-account.ts:12-15) — an unauthenticated caller must
//     bounce to sign-in *before* any client exists, so a privileged client is
//     never constructed on an anonymous request;
//   * the two-client requirement — deletion needs both the admin client (to
//     remove the auth.users row) and the request client (to end the session), so
//     either one being absent has to fail the same way.

// Both factories keep their real implementations by default — the
// `astro:env/server` stub leaves every value empty, so unmocked they genuinely
// return null and each unavailable case is exercised against production code.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});
vi.mock("@/lib/supabase-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-admin")>();
  return { ...actual, createAdminClient: vi.fn(actual.createAdminClient) };
});

const UNAVAILABLE = "/dashboard?error=Account%20deletion%20is%20unavailable";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/delete-account", () => {
  it("bounces an unauthenticated caller to sign-in without building any client", async () => {
    const response = await POST(makeContext({ method: "POST", user: null }));

    expect(redirectLocation(response)).toBe("/auth/signin");
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("reports deletion unavailable when the service-role client is missing", async () => {
    vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth: { signOut: vi.fn() } }));

    const response = await POST(makeContext({ method: "POST", user: makeUser() }));

    expect(redirectLocation(response)).toBe(UNAVAILABLE);
  });

  it("reports deletion unavailable when the request client is missing", async () => {
    vi.mocked(createAdminClient).mockReturnValueOnce(makeAdminClient({ auth: { admin: { deleteUser: vi.fn() } } }));

    const response = await POST(makeContext({ method: "POST", user: makeUser() }));

    expect(redirectLocation(response)).toBe(UNAVAILABLE);
  });

  it("redirects back with the provider's message when the deletion fails", async () => {
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(createAdminClient).mockReturnValueOnce(
      makeAdminClient({
        auth: { admin: { deleteUser: vi.fn(() => Promise.resolve({ error: { message: "User not found" } })) } },
      }),
    );
    vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth: { signOut } }));

    const response = await POST(makeContext({ method: "POST", user: makeUser() }));

    expect(redirectLocation(response)).toBe("/dashboard?error=User%20not%20found");
    // The session survives a failed deletion — signing them out would strand a
    // still-existing account behind a logged-out browser.
    expect(signOut).not.toHaveBeenCalled();
  });

  it("deletes the caller's own row, ends the session, and lands on the map", async () => {
    const deleteUser = vi.fn(() => Promise.resolve({ error: null }));
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    vi.mocked(createAdminClient).mockReturnValueOnce(makeAdminClient({ auth: { admin: { deleteUser } } }));
    vi.mocked(createClient).mockReturnValueOnce(makeSupabaseClient({ auth: { signOut } }));

    const response = await POST(makeContext({ method: "POST", user: makeUser("learner-1") }));

    expect(redirectLocation(response)).toBe("/");
    // The id comes from `locals.user`, never from the request body — a caller
    // cannot name someone else's account.
    expect(deleteUser).toHaveBeenCalledWith("learner-1");
    expect(signOut).toHaveBeenCalledOnce();
  });
});
