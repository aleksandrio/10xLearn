// Test stub for the `astro:middleware` virtual module, mirroring
// vitest.astro-env-server.stub.ts. Astro generates that module as part of its
// build; Vitest runs outside the Astro pipeline and can't resolve it, so
// vitest.config.ts aliases the specifier to this file.
//
// `defineMiddleware` is an identity function in Astro too — it exists purely so
// the handler's `context` and `next` get contextual types — which is why this
// stub is faithful rather than merely inert. The type comes from the real
// package, so the stub cannot drift from the signature it stands in for.
import type { MiddlewareHandler } from "astro";

export function defineMiddleware(fn: MiddlewareHandler): MiddlewareHandler {
  return fn;
}
