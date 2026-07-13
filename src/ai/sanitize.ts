/**
 * Privacy and safety for NL purchase intake.
 * Never log or persist raw purchase text by default.
 */

const SENSITIVE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(?:\d[ -]*?){13,19}\b/, reason: "possible_card_number" },
  { re: /\bcvv\b\s*:?\s*\d{3,4}\b/i, reason: "cvv" },
  { re: /\bpassword\b\s*[:=]/i, reason: "password" },
  { re: /\b2fa\b|\botp\b|\bauthenticator\b/i, reason: "2fa" },
  { re: /\bssn\b|\bsocial security\b/i, reason: "ssn" },
  { re: /\bprivate[_\s-]?key\b|\bseed[_\s-]?phrase\b/i, reason: "wallet_or_key" },
  { re: /\brouting\b\s*#?\s*\d{9}\b/i, reason: "bank_routing" },
];

const INJECTION_MARKERS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s*:\s*/i,
  /you\s+are\s+now\s+/i,
  /disregard\s+(the\s+)?(rules|instructions)/i,
  /<\/?system>/i,
];

export function detectSensitive(text: string): {
  sensitive: boolean;
  reason: string | null;
  redacted: string;
} {
  let redacted = text;
  let reason: string | null = null;
  for (const { re, reason: r } of SENSITIVE_PATTERNS) {
    if (re.test(text)) {
      reason = r;
      redacted = redacted.replace(re, "[REDACTED]");
    }
  }
  return { sensitive: reason != null, reason, redacted };
}

export function stripInjectionAttempts(text: string): string {
  let out = text;
  for (const re of INJECTION_MARKERS) {
    out = out.replace(re, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Hash for audit without storing raw text. */
export async function hashPurchaseText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function auditExtractEvent(event: {
  outcome: string;
  provider?: string;
  text_hash?: string;
  text_length?: number;
  duration_ms?: number;
}): void {
  // Never include raw purchase_text
  console.info(
    "nobu_ai_extract",
    JSON.stringify({
      at: new Date().toISOString(),
      ...event,
    }),
  );
}
