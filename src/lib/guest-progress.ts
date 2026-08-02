// Signed guest-progress cookie (S-01, rescored in S-04). Owns the HMAC-signed
// cookie that records a guest's *best score per zone*, so the world map and XP
// badge render correctly on first paint without a login. Web Crypto only
// (`crypto.subtle`) — `node:crypto` is not available on the Cloudflare workerd
// runtime we deploy to.
//
// Scores, not unlocks or bare completions. Each format fixed a blind spot in the
// one before it:
//   * unlocked slugs   — a pass of the *final* zone unlocks nothing, so it was
//                        unrepresentable: no XP, and lost at signup.
//   * completed slugs  — binary, so a retake could never improve anything.
//   * best scores      — carries how well, not just whether, which is what
//                        partial credit and "is it a record?" both need.
// Each is a JSON payload under a distinct cookie name, so an older cookie is
// ignored rather than silently misread as the current shape.
//
// This module is deliberately DB-agnostic: it verifies and (de)serializes the
// per-zone scores and nothing more. Turning those into attempts, unlocks (with
// the "first zone is always free" default) and XP is DB-aware and lives in
// `@/lib/game` + `@/lib/progress`, because only those layers know the play order
// (`order_index`) and the XP weights.

import type { AstroCookies } from "astro";
import { GUEST_PROGRESS_SECRET } from "astro:env/server";

// A guest's scores are convenience state, not security — a generous window so a
// refresh (and a short-term return) keeps their progress.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Cookie name holding the signed per-zone best scores. Distinct from the earlier
 * `guest_progress` (unlocked slugs) and `guest_completions` (completed slugs)
 * names on purpose — see the module header. A stale cookie under either old name
 * is simply ignored.
 */
export const GUEST_SCORES_COOKIE = "guest_scores";

/** A guest's best result on one zone's quiz. */
export interface GuestScore {
  correctCount: number;
  questionTotal: number;
}

/** Best score per zone slug — the whole of what the cookie carries. */
export type GuestScores = Map<string, GuestScore>;

// Dev-only fallback so local dev works without configuring a secret. This is
// intentionally insecure and documented as such — a real secret is set in the
// Cloudflare/deploy environment via `GUEST_PROGRESS_SECRET`.
const DEV_FALLBACK_SECRET = "insecure-dev-guest-progress-secret";

const encoder = new TextEncoder();

function secret(): string {
  if (GUEST_PROGRESS_SECRET) return GUEST_PROGRESS_SECRET;
  // Never sign/verify with the public dev key in production — a misconfigured
  // deploy would let anyone forge an unlock cookie. Fail closed instead.
  if (import.meta.env.PROD) {
    throw new Error("GUEST_PROGRESS_SECRET must be set in production.");
  }
  return DEV_FALLBACK_SECRET;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
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

async function sign(payload: string): Promise<string> {
  const key = await importKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
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
 * Verify and decode the guest-progress cookie into the per-zone best scores it
 * carries. Fail-safe: a missing, malformed, or tampered cookie yields an empty
 * map — never throws, never a 500. Individual malformed entries are dropped
 * rather than poisoning the whole set. Turning scores into attempts, unlocks and
 * XP is the DB-aware layer's job in `@/lib/progress`.
 *
 * Wire shape is a compact `[slug, correct, total]` triple array:
 * `[["foundations",2,3]]`.
 */
export async function readGuestScores(cookieValue: string | undefined): Promise<GuestScores> {
  const scores: GuestScores = new Map();
  if (!cookieValue) return scores;

  const separator = cookieValue.indexOf(".");
  if (separator <= 0) return scores;

  const payload = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  if (!(await verify(payload, signature))) return scores;

  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return scores;

    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 3) continue;
      const [slug, correctCount, questionTotal] = entry as unknown[];
      if (typeof slug !== "string" || !slug) continue;
      if (!Number.isInteger(correctCount) || !Number.isInteger(questionTotal)) continue;
      const correct = correctCount as number;
      const total = questionTotal as number;
      // A score outside 0..total is nonsense; drop it rather than let a tampered
      // (but somehow signed) payload inflate XP.
      if (total <= 0 || correct < 0 || correct > total) continue;
      scores.set(slug, { correctCount: correct, questionTotal: total });
    }
    return scores;
  } catch {
    return new Map();
  }
}

/**
 * Serialize + HMAC-sign the per-zone best scores and set them as the guest-
 * progress cookie. Same secret and `payload.signature` format the read side
 * verifies. Scores only ever come from a server-side grading result (never
 * client-supplied) before this runs.
 */
export async function writeGuestScores(cookies: AstroCookies, scores: GuestScores): Promise<void> {
  const triples = [...scores.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, score]) => [slug, score.correctCount, score.questionTotal]);
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(triples)));
  const signature = await sign(payload);
  cookies.set(GUEST_SCORES_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: import.meta.env.PROD,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}
