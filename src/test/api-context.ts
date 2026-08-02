// Shared fake `APIContext` for the API-route smoke tests. Route handlers are
// imported and invoked directly — there is no Astro runtime under Vitest — so
// every route test needs a stand-in context. Building it in one place keeps the
// two unavoidable casts out of the test files, which are linted under
// `strictTypeChecked` like the rest of the repo:
//
//   * `AstroCookies` is a class with private fields, so a structural fake can
//     never satisfy the type however complete it is.
//   * `APIContext` has ~15 required members, all but five of which no route in
//     this repo reads.
//
// Deliberately not a `.test.ts` file: `vitest.config.ts`'s `include` glob would
// otherwise collect it and fail with "no test suite found".

import type { APIContext, AstroCookies, MiddlewareHandler } from "astro";
import type { User } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase";
import type { createAdminClient } from "@/lib/supabase-admin";

/** What a configured `createClient` hands back — and so what a mocked one must return. */
type ServerClient = NonNullable<ReturnType<typeof createClient>>;

/** The service-role counterpart, for the one route that needs both. */
type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Origin for relative `url` overrides. Also the origin a same-site request is
 * compared against, so CSRF cases can state their `Origin` header explicitly.
 */
export const TEST_ORIGIN = "https://10xlearn.test";

export interface ContextOverrides {
  /** Absolute URL, or a path resolved against `TEST_ORIGIN`. */
  url?: string | URL;
  /** Defaults to POST when a body is supplied, GET otherwise. */
  method?: string;
  headers?: Record<string, string>;
  /** Form fields, sent url-encoded so `request.formData()` is genuine. */
  form?: Record<string, string>;
  /** Serialized to JSON, so `request.json()` is genuine. */
  json?: unknown;
  /** Raw body, for the malformed-payload cases `json` cannot express. */
  rawBody?: string;
  /** Cookies already present on the request, by name. */
  cookies?: Record<string, string>;
  /** `context.locals.user` — null (a guest) unless supplied. */
  user?: User | null;
}

/**
 * A `Map`-backed `AstroCookies`. `get` returns `{ value }` because that is the
 * shape every call site destructures (`cookies.get(NAME)?.value`); `set`/`delete`
 * accept and ignore Astro's options argument, which nothing under test asserts on.
 */
function makeCookies(initial: Record<string, string>): AstroCookies {
  const store = new Map(Object.entries(initial));
  const fake = {
    get: (key: string) => {
      const value = store.get(key);
      return value === undefined ? undefined : { value };
    },
    set: (key: string, value: string, _options?: unknown) => {
      store.set(key, value);
    },
    delete: (key: string, _options?: unknown) => {
      store.delete(key);
    },
    has: (key: string) => store.has(key),
  };
  return fake as unknown as AstroCookies;
}

/**
 * The fake context a route handler is called with. Only the five members routes
 * actually touch are real — `request`, `cookies`, `url`, `locals`, `redirect`.
 */
export function makeContext(overrides: ContextOverrides = {}): APIContext {
  const url = overrides.url instanceof URL ? overrides.url : new URL(overrides.url ?? "/", TEST_ORIGIN);

  const headers = new Headers(overrides.headers);
  let body: BodyInit | undefined;
  if (overrides.form) {
    body = new URLSearchParams(overrides.form);
  } else if (overrides.rawBody !== undefined) {
    body = overrides.rawBody;
  } else if (overrides.json !== undefined) {
    body = JSON.stringify(overrides.json);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  const request = new Request(url, {
    method: overrides.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });

  const context = {
    request,
    url,
    cookies: makeCookies(overrides.cookies ?? {}),
    locals: { user: overrides.user ?? null },
    // Astro's own `redirect` defaults to 302. Tests assert on `Location` rather
    // than on the status, so this default never becomes load-bearing.
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  };

  return context as unknown as APIContext;
}

/** A `User` with only `id` meaningful — the sole field any route reads off it. */
export function makeUser(id = "user-1"): User {
  return {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * A stand-in for a configured Supabase client. Routes never call into it
 * directly — they hand it to the `@/lib/*` collaborators a test has already
 * mocked — so callers supply only the members their route reaches (an `auth`
 * fake, typically) and the ~40 others stay absent behind the cast.
 */
export function makeSupabaseClient(members: Record<string, unknown> = {}): ServerClient {
  return members as unknown as ServerClient;
}

/** The same stand-in for `createAdminClient`, whose return type is a distinct client. */
export function makeAdminClient(members: Record<string, unknown> = {}): AdminClient {
  return members as unknown as AdminClient;
}

/**
 * A middleware result narrowed to the `Response` it must be. `MiddlewareHandler`
 * is declared as returning a `Response` *or* nothing, so without this every
 * assertion in src/middleware.test.ts would carry its own narrowing. The
 * parameter is derived from Astro's own type rather than restated, so it cannot
 * drift from what `onRequest` actually returns.
 */
export function asResponse(result: Awaited<ReturnType<MiddlewareHandler>>): Response {
  if (!(result instanceof Response)) {
    throw new Error("Expected the middleware to return a Response.");
  }
  return result;
}

/** The `Location` a redirect response carries — what redirect assertions read. */
export function redirectLocation(response: Response): string | null {
  return response.headers.get("Location");
}

/**
 * A response's parsed JSON body. `Response.json()` is typed `Promise<any>`, which
 * trips `no-unsafe-*` at every assertion site; funnel it through here so the
 * tests see `unknown` (or whatever they ask for) instead.
 */
export async function jsonBody<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
