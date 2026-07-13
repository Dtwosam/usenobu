/**
 * Redact secrets and sensitive query parameters from SerpApi payloads and errors.
 * Never log or commit API keys.
 */

const KEY_PATTERNS: RegExp[] = [
  /([?&]api_key=)[^&"'\s]+/gi,
  /("api_key"\s*:\s*")[^"]*(")/gi,
  /('api_key'\s*:\s*')[^']*(')/gi,
  /(api[_-]?key\s*[:=]\s*)([^\s"',}]+)/gi,
  /(Bearer\s+)[A-Za-z0-9._\-]+/gi,
];

export function redactSecrets(
  value: string,
  apiKey?: string | null,
): string {
  let out = value;
  if (apiKey && apiKey.length > 0) {
    out = out.split(apiKey).join("[REDACTED_API_KEY]");
  }
  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, (_match, p1: string, p2?: string) => {
      if (typeof p2 === "string" && p2.startsWith('"')) {
        return `${p1}[REDACTED]${p2}`;
      }
      if (typeof p2 === "string" && p2.startsWith("'")) {
        return `${p1}[REDACTED]${p2}`;
      }
      // api_key= value or prefix-only groups
      if (p1.includes("api_key=") || p1.toLowerCase().includes("api")) {
        return `${p1}[REDACTED]`;
      }
      return `${p1}[REDACTED]`;
    });
  }
  return out;
}

export function redactError(
  error: unknown,
  apiKey?: string | null,
): string {
  if (error instanceof Error) {
    return redactSecrets(
      `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`,
      apiKey,
    );
  }
  return redactSecrets(String(error), apiKey);
}

/** Deep-clone JSON-compatible values and redact api_key fields. */
export function redactJsonValue<T>(value: T, apiKey?: string | null): T {
  return JSON.parse(
    redactSecrets(JSON.stringify(value), apiKey),
  ) as T;
}

export function assertNoSecretLeak(
  text: string,
  apiKey?: string | null,
): void {
  if (apiKey && apiKey.length > 0 && text.includes(apiKey)) {
    throw new Error("Secret leak detected: API key present in output");
  }
  if (/[?&]api_key=[^&\[REDACTED\]]+/i.test(text) && !text.includes("[REDACTED]")) {
    // loose check for unredacted query param values of reasonable length
    const m = text.match(/[?&]api_key=([^&\s"']+)/i);
    if (m?.[1] && m[1].length > 8 && m[1] !== "[REDACTED]") {
      throw new Error("Secret leak detected: api_key query parameter");
    }
  }
}
