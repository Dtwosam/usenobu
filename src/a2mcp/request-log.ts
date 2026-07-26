/**
 * Lane 8R.3B — safe structured request logging.
 *
 * Lane 8R.3A could not reconstruct the OKX review window because nothing
 * recorded how a request was shaped: method, content type, content length,
 * top-level key names, recognised action, status, and duration were all
 * missing (`docs/proof/lane-8r-3a-timeout-diagnosis/README.md` §4.4).
 *
 * This logs exactly those facts and nothing else. Field VALUES, headers,
 * emails, tokens, payment authorizations, wallet addresses and purchase text
 * are never touched — only the sorted *names* of top-level keys.
 */

/** Key names that must never be echoed, even as a name. */
const SENSITIVE_KEY_NAMES = [
  "password",
  "card_number",
  "cvv",
  "private_key",
  "seed_phrase",
  "2fa",
  "otp",
  "connection_token",
  "monitoring_pass_token",
];

function safeKeyNames(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.keys(raw as object)
    .map((k) => {
      const lower = k.toLowerCase();
      return SENSITIVE_KEY_NAMES.some((s) => lower.includes(s))
        ? `${k}:[redacted-name]`
        : k;
    })
    .sort();
}

export interface A2mcpRequestLogInput {
  route: string;
  method: string;
  contentType: string | null;
  contentLength: number | null;
  body: unknown;
  recognisedAction: string | null;
  httpStatus: number;
  durationMs: number;
  outcome: string;
  clientDisconnected?: boolean;
}

/**
 * One structured line per request. Emitted to stdout so the platform's log
 * retention/drain captures it; it carries no value from the request body.
 */
export function logA2mcpRequest(input: A2mcpRequestLogInput): void {
  console.log(
    "nobu_a2mcp_request",
    JSON.stringify({
      at: new Date().toISOString(),
      route: input.route,
      method: input.method,
      content_type: input.contentType,
      content_length: input.contentLength,
      top_level_keys: safeKeyNames(input.body),
      recognised_action: input.recognisedAction,
      http_status: input.httpStatus,
      duration_ms: input.durationMs,
      outcome: input.outcome,
      client_disconnected: input.clientDisconnected ?? false,
    }),
  );
}

/** Parses Content-Length without throwing. */
export function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
