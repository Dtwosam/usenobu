/**
 * Official OKX seller-side x402 facilitator HTTP client.
 *
 * Source of truth: github.com/okx/payments TypeScript OKXFacilitatorClient
 * (HMAC-SHA256 REST auth) + official paths:
 *   POST /api/v6/pay/x402/verify
 *   POST /api/v6/pay/x402/settle
 *   GET  /api/v6/pay/x402/settle/status?txHash=...
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
  resource: string;
  payTo: string;
  /** Must mirror the accepts entry the buyer signed (Lane 8R.3B). */
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

export type OkxHttpFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

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
    const res = await this.fetchImpl(this.config.baseUrl + path, {
      method: "POST",
      headers: this.headers("POST", path, body),
      body,
    });
    if (!res.ok) {
      console.error("nobu_okx_verify_http_error", { status: res.status });
      throw new Error("okx_verify_http_error");
    }
    const json = (await res.json()) as Record<string, unknown>;
    return (json.data ?? json) as OkxVerifyResponse;
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
    const res = await this.fetchImpl(this.config.baseUrl + path, {
      method: "POST",
      headers: this.headers("POST", path, body),
      body,
    });
    if (!res.ok) {
      console.error("nobu_okx_settle_http_error", { status: res.status });
      throw new Error("okx_settle_http_error");
    }
    const json = (await res.json()) as Record<string, unknown>;
    return (json.data ?? json) as OkxSettleResponse;
  }

  async getSettleStatus(txHash: string): Promise<OkxSettleStatusResponse> {
    const path = `/api/v6/pay/x402/settle/status?txHash=${encodeURIComponent(txHash)}`;
    const res = await this.fetchImpl(this.config.baseUrl + path, {
      method: "GET",
      headers: this.headers("GET", path),
    });
    if (!res.ok) {
      console.error("nobu_okx_settle_status_http_error", { status: res.status });
      throw new Error("okx_settle_status_http_error");
    }
    const json = (await res.json()) as Record<string, unknown>;
    return (json.data ?? json) as OkxSettleStatusResponse;
  }
}
