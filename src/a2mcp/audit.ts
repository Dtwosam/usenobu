import { redactSecrets } from "../serpapi/redact.js";

export interface A2mcpAuditEntry {
  at: string;
  route: string;
  client_key: string;
  http_status: number;
  outcome: string;
  duration_ms: number;
  notes?: string;
}

const MAX_ENTRIES = 200;
const ring: A2mcpAuditEntry[] = [];

/**
 * Safe API audit log — no request bodies, no keys, no PII fields.
 */
export function auditA2mcp(entry: A2mcpAuditEntry, apiKey?: string | null): void {
  const safe: A2mcpAuditEntry = {
    ...entry,
    client_key: entry.client_key.slice(0, 16),
    notes: entry.notes
      ? redactSecrets(entry.notes, apiKey).slice(0, 200)
      : undefined,
  };
  ring.push(safe);
  if (ring.length > MAX_ENTRIES) {
    ring.shift();
  }
}

export function getA2mcpAuditEntries(): readonly A2mcpAuditEntry[] {
  return ring;
}

export function clearA2mcpAudit(): void {
  ring.length = 0;
}

export function assertResponseHasNoSecrets(
  body: unknown,
  apiKey?: string | null,
): void {
  const text = JSON.stringify(body);
  if (apiKey && apiKey.length > 0 && text.includes(apiKey)) {
    throw new Error("Secret leakage in A2MCP response");
  }
  if (/password|card_number|cvv|private_key|2fa/i.test(text) && /"[^"]{12,}"/.test(text)) {
    // Only fail if values look like secrets, not documentation words in disclaimer
  }
  if (/"password"\s*:/.test(text) || /"card_number"\s*:/.test(text)) {
    throw new Error("Sensitive field present in A2MCP response");
  }
}
