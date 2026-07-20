/**
 * Crypto helpers for passwordless auth — never log raw tokens or emails.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

/** Normalize email for storage/lookup. Never invent domain corrections. */
export function normalizeEmail(raw: string): string | null {
  const t = String(raw || "").trim().toLowerCase();
  if (!t || t.length > 254) return null;
  // Practical RFC-ish validation — no disposable-list gating in MVP
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  if (t.includes("..")) return null;
  return t;
}

export function isValidEmail(raw: string): boolean {
  return normalizeEmail(raw) != null;
}

/** Display-safe: first character uppercased for avatar; never log full email. */
export function emailInitial(email: string): string {
  const c = String(email || "").trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}

export function truncateEmail(email: string, max = 28): string {
  const e = String(email || "").trim();
  if (e.length <= max) return e;
  const at = e.indexOf("@");
  if (at <= 0) return `${e.slice(0, max - 1)}…`;
  const local = e.slice(0, at);
  const domain = e.slice(at);
  const keep = Math.max(2, max - domain.length - 1);
  return `${local.slice(0, keep)}…${domain}`;
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
