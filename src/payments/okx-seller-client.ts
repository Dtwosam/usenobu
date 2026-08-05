/**
 * Official OKX seller-side x402 facilitator HTTP client.
 *
 * Aligns with @okxweb3/x402-core OKXFacilitatorClient:
 *   GET  /api/v6/pay/x402/supported
 *   POST /api/v6/pay/x402/verify
 *   POST /api/v6/pay/x402/settle
 *   GET  /api/v6/pay/x402/settle/status?txHash=...
 *
 * Improvements over a raw re-export of the SDK client:
 *   - require top-level OKX business `code === "0"` before reading `data`
 *   - injectable fetch for tests
 *   - classify transport failures after settle submission for settlement_unknown
 *
 * Never logs API secrets, payment payloads, or signatures.
 */
import { createHmac } from "node:crypto";

export const OKX_X402_VERSION = 2;
export const OKX_DEFAULT_BASE_URL = "https://web3.okx.com";

export type OkxSellerConfig = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl: string;
  /** Recipient wallet — server env only. */
  payTo: string;
  /** When true, settle waits for on-chain confirmation. Default false → may return pending. */
  syncSettle?: boolean;
};

export type PaymentPayload = Record<string, unknown>;

export type PaymentRequirements = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  /** Official facilitator shape omits resource; kept optional for legacy. */
  resource?: string;
  payTo: string;
  /** Must mirror the accepts entry the buyer signed. */
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};

export type OkxVerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
};

export type OkxSettleResponse = {
  success: boolean;
  status?: "pending" | "success" | "timeout";
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network?: string;
  amount?: string;
};

export type OkxSettleStatusResponse = {
  success: boolean;
  status?: "pending" | "success" | "failed";
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction?: string;
  network?: string;
};

export type OkxSupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
};

export type OkxSupportedResponse = {
  kinds: OkxSupportedKind[];
  extensions?: string[];
  signers?: Record<string, string[]>;
};

export type OkxHttpFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/** Structured client errors — never include raw payment material. */
export class OkxSellerHttpError extends Error {
  readonly status: number;
  readonly operation: "verify" | "settle" | "settle_status" | "supported";
  constructor(
    operation: OkxSellerHttpError["operation"],
    status: number,
    message?: string,
  ) {
    super(message ?? `okx_${operation}_http_${status}`);
    this.name = "OkxSellerHttpError";
    this.status = status;
    this.operation = operation;
  }
}

export class OkxSellerBusinessError extends Error {
  readonly code: string;
  readonly operation: "verify" | "settle" | "settle_status" | "supported";
  readonly msg?: string;
  constructor(
    operation: OkxSellerBusinessError["operation"],
    code: string,
    msg?: string,
  ) {
    super(`okx_${operation}_business_${code}`);
    this.name = "OkxSellerBusinessError";
    this.code = code;
    this.operation = operation;
    this.msg = msg;
  }
}

export function loadOkxSellerConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): OkxSellerConfig | null {
  const apiKey = String(env.OKX_API_KEY || "").trim();
  const secretKey = String(env.OKX_SECRET_KEY || "").trim();
  const passphrase = String(env.OKX_PASSPHRASE || "").trim();
  const payTo = String(env.OKX_PAY_TO || env.PAY_TO || "").trim();
  const baseUrl = String(env.OKX_BASE_URL || OKX_DEFAULT_BASE_URL)
    .trim()
    .replace(/\/$/, "");
  if (!apiKey || !secretKey || !passphrase || !payTo) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(payTo)) return null;
  const syncRaw = String(env.OKX_SYNC_SETTLE || "").trim().toLowerCase();
  return {
    apiKey,
    secretKey,
    passphrase,
    baseUrl,
    payTo,
    syncSettle: syncRaw === "1" || syncRaw === "true",
  };
}

export function isOkxSellerConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return loadOkxSellerConfig(env) !== null;
}

/** OKX REST HMAC-SHA256: timestamp + method + path + body */
export function createOkxAccessHeaders(args: {
  method: string;
  path: string;
  body?: string;
  apiKey: string;
  secretKey: string;
  passphrase: string;
  timestamp?: string;
}): Record<string, string> {
  const timestamp = args.timestamp ?? new Date().toISOString();
  const prehash = timestamp + args.method + args.path + (args.body ?? "");
  const sign = createHmac("sha256", args.secretKey)
    .update(prehash)
    .digest("base64");
  return {
    "OK-ACCESS-KEY": args.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": args.passphrase,
    "Content-Type": "application/json",
  };
}

/**
 * Require top-level OKX envelope `code === "0"` before reading `data`.
 * Falls back to treating a bare body as data only when `code` is absent
 * (some mocked/test facilitators).
 */
export function parseOkxEnvelope<T>(
  json: unknown,
  operation: OkxSellerBusinessError["operation"],
): T {
  if (!json || typeof json !== "object") {
    throw new OkxSellerBusinessError(operation, "malformed", "empty_body");
  }
  const obj = json as Record<string, unknown>;
  if ("code" in obj) {
    const code = String(obj.code);
    if (code !== "0") {
      const msg =
        typeof obj.msg === "string"
          ? obj.msg
          : typeof obj.message === "string"
            ? obj.message
            : undefined;
      throw new OkxSellerBusinessError(operation, code, sanitizeReason(msg));
    }
    return (obj.data ?? {}) as T;
  }
  // Bare payload (tests / older mocks)
  return obj as T;
}

/** Strip anything that looks like a signature/hex blob from provider text. */
export function sanitizeReason(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw).slice(0, 240);
  // Collapse long hex / base64-looking segments
  s = s.replace(/0x[a-fA-F0-9]{16,}/g, "0x[redacted]");
  s = s.replace(/[A-Za-z0-9+/=_-]{40,}/g, "[redacted]");
  return s.trim() || undefined;
}

export class OkxSellerClient {
  constructor(
    private readonly config: OkxSellerConfig,
    private readonly fetchImpl: OkxHttpFetch = fetch,
  ) {}

  get payTo(): string {
    return this.config.payTo;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  private headers(method: string, path: string, body?: string) {
    return createOkxAccessHeaders({
      method,
      path,
      body,
      apiKey: this.config.apiKey,
      secretKey: this.config.secretKey,
      passphrase: this.config.passphrase,
    });
  }

  private async requestJson(
    operation: OkxSellerHttpError["operation"],
    method: string,
    path: string,
    body?: string,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.baseUrl + path, {
        method,
        headers: this.headers(method, path, body),
        body,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network_error";
      throw new OkxSellerHttpError(operation, 0, `okx_${operation}_transport: ${sanitizeReason(msg)}`);
    }
    if (!res.ok) {
      console.error("nobu_okx_http_error", {
        operation,
        status: res.status,
      });
      throw new OkxSellerHttpError(operation, res.status);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new OkxSellerBusinessError(operation, "malformed", "invalid_json");
    }
    return parseOkxEnvelope(json, operation);
  }

  async getSupported(): Promise<OkxSupportedResponse> {
    const path = "/api/v6/pay/x402/supported";
    const data = await this.requestJson("supported", "GET", path);
    return data as OkxSupportedResponse;
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<OkxVerifyResponse> {
    const path = "/api/v6/pay/x402/verify";
    const body = JSON.stringify({
      x402Version: OKX_X402_VERSION,
      paymentPayload: payload,
      paymentRequirements: requirements,
    });
    const data = await this.requestJson("verify", "POST", path, body);
    return data as OkxVerifyResponse;
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<OkxSettleResponse> {
    const path = "/api/v6/pay/x402/settle";
    const bodyObj: Record<string, unknown> = {
      x402Version: OKX_X402_VERSION,
      paymentPayload: payload,
      paymentRequirements: requirements,
    };
    if (this.config.syncSettle !== undefined) {
      bodyObj.syncSettle = this.config.syncSettle;
    }
    const body = JSON.stringify(bodyObj);
    const data = await this.requestJson("settle", "POST", path, body);
    return data as OkxSettleResponse;
  }

  async getSettleStatus(txHash: string): Promise<OkxSettleStatusResponse> {
    const path = `/api/v6/pay/x402/settle/status?txHash=${encodeURIComponent(txHash)}`;
    const data = await this.requestJson("settle_status", "GET", path);
    return data as OkxSettleStatusResponse;
  }
}
