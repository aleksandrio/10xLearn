// Signed guest-progress cookie (S-01). Owns the HMAC-signed cookie that records
// which zones a guest has unlocked, so the world map renders correctly on first
// paint without a login. Web Crypto only (`crypto.subtle`) — `node:crypto` is
// not available on the Cloudflare workerd runtime we deploy to.
//
// This module is deliberately DB-agnostic: it verifies and (de)serializes the
// set of unlocked zone *slugs* carried by the cookie and nothing more. The
// "first zone is always unlocked" default is DB-aware and lives in `@/lib/game`
// (`isZoneUnlocked` / `buildMapModel`), because only that layer knows which zone
// is first by `order_index`. The write/sign side lands in Phase 3.

import { GUEST_PROGRESS_SECRET } from "astro:env/server";

/** Cookie name holding the signed set of unlocked zone slugs. */
export const GUEST_PROGRESS_COOKIE = "guest_progress";

// Dev-only fallback so local dev works without configuring a secret. This is
// intentionally insecure and documented as such — a real secret is set in the
// Cloudflare/deploy environment via `GUEST_PROGRESS_SECRET`.
const DEV_FALLBACK_SECRET = "insecure-dev-guest-progress-secret";

const encoder = new TextEncoder();

function secret(): string {
  return GUEST_PROGRESS_SECRET ?? DEV_FALLBACK_SECRET;
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function verify(payload: string, signature: string): Promise<boolean> {
  try {
    const key = await importKey();
    return await crypto.subtle.verify("HMAC", key, base64UrlToBytes(signature), encoder.encode(payload));
  } catch {
    return false;
  }
}

/**
 * Verify and decode the guest-progress cookie into the set of unlocked zone
 * slugs it carries. Fail-safe: a missing, malformed, or tampered cookie yields
 * an empty set — never throws, never a 500. The "first zone is always unlocked"
 * default is applied by the DB-aware layer in `@/lib/game`.
 */
export async function readUnlockedZones(cookieValue: string | undefined): Promise<Set<string>> {
  if (!cookieValue) return new Set();

  const separator = cookieValue.indexOf(".");
  if (separator <= 0) return new Set();

  const payload = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  if (!(await verify(payload, signature))) return new Set();

  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((slug): slug is string => typeof slug === "string"));
  } catch {
    return new Set();
  }
}
