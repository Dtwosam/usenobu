import { ProviderStatus } from "../domain/enums.js";
import { hashRawPayload, normalizeShoppingResponse } from "./normalize.js";
import { redactError, redactSecrets } from "./redact.js";
import { InMemorySearchUsageRecorder } from "./search-usage.js";
import type {
  SerpApiClientOptions,
  SerpApiShoppingQuery,
  SerpApiShoppingResult,
  SearchUsageRecorder,
} from "./types.js";

const DEFAULT_BASE = "https://serpapi.com/search.json";
const DEFAULT_TIMEOUT_MS = 15_000;

export class SerpApiError extends Error {
  readonly provider_status: (typeof ProviderStatus)[keyof typeof ProviderStatus];
  readonly http_status?: number;
  readonly redacted_detail: string;

  constructor(args: {
    message: string;
    provider_status: (typeof ProviderStatus)[keyof typeof ProviderStatus];
    http_status?: number;
    redacted_detail: string;
  }) {
    super(args.message);
    this.name = "SerpApiError";
    this.provider_status = args.provider_status;
    this.http_status = args.http_status;
    this.redacted_detail = args.redacted_detail;
  }
}

/**
 * Server-only SerpApi Google Shopping client.
 * SerpApi is a third-party observation source — not an official Target API.
 * Does not perform product matching or eligibility decisions.
 */
export class SerpApiShoppingClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly usage: SearchUsageRecorder;
  private readonly now: () => Date;

  constructor(options: SerpApiClientOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error("SERPAPI_API_KEY is required for live SerpApi client");
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.usage = options.usageCounter ?? new InMemorySearchUsageRecorder();
    this.now = options.now ?? (() => new Date());
  }

  getUsageCount(): number {
    return this.usage.getCount();
  }

  getUsageEntries() {
    return this.usage.getEntries();
  }

  /**
   * Normalize a fixture or previously fetched payload without a network call.
   */
  normalizeFixture(
    raw: unknown,
    query: SerpApiShoppingQuery,
    options?: { live?: boolean; httpStatus?: number; recordAsSearch?: boolean },
  ): SerpApiShoppingResult {
    const resolved = this.resolveQuery(query);
    const observedAt = this.now().toISOString();
    if (options?.recordAsSearch) {
      this.usage.record({
        at: observedAt,
        engine: "google_shopping",
        query: resolved.q || resolved.shoprs || "(empty)",
        live: options.live === true,
        http_status: options.httpStatus,
        shoprs_used: Boolean(resolved.shoprs),
      });
    }
    const result = normalizeShoppingResponse({
      raw,
      query: resolved,
      observedAt,
      live: options?.live === true,
      searchesRecorded: this.usage.getCount(),
      httpStatus: options?.httpStatus,
    });
    if (options?.recordAsSearch) {
      const entries = this.usage.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        (last as { provider_status?: typeof result.provider_status }).provider_status =
          result.provider_status;
      }
    }
    return result;
  }

  async searchShopping(query: SerpApiShoppingQuery): Promise<SerpApiShoppingResult> {
    const resolved = this.resolveQuery(query);
    if (!resolved.q && !resolved.shoprs) {
      throw new Error("SerpApi shopping query requires q and/or shoprs");
    }
    const timeoutMs = query.timeout_ms ?? this.defaultTimeoutMs;
    const observedAt = this.now().toISOString();
    const url = this.buildUrl(resolved);
    const queryLabel = resolved.q || `[shoprs]`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let httpStatus: number | undefined;
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json; charset=utf-8",
          "Accept-Charset": "utf-8",
          "User-Agent":
            "Nobu/0.1 (server-side SerpApi connector; third-party observation)",
        },
        signal: controller.signal,
      });
      httpStatus = response.status;
      // Force UTF-8 decode of response body (SerpApi JSON is UTF-8)
      const buf = Buffer.from(await response.arrayBuffer());
      const text = buf.toString("utf8");
      const redactedText = redactSecrets(text, this.apiKey);

      let raw: unknown;
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        this.usage.record({
          at: observedAt,
          engine: "google_shopping",
          query: queryLabel,
          live: true,
          http_status: httpStatus,
          provider_status: ProviderStatus.PROVIDER_ERROR,
          error_class: "invalid_json",
          shoprs_used: Boolean(resolved.shoprs),
        });
        return {
          provider: "SerpApi",
          engine: "google_shopping",
          provider_status: ProviderStatus.PROVIDER_ERROR,
          query: resolved,
          observed_at: observedAt,
          offers: [],
          target_offers: [],
          filters: [],
          target_shoprs_tokens: [],
          error_message: "Invalid JSON from SerpApi",
          raw_result_hash: hashRawPayload({
            redacted: redactedText.slice(0, 500),
          }),
          live: true,
          searches_recorded: this.usage.getCount(),
        };
      }

      const result = normalizeShoppingResponse({
        raw,
        query: resolved,
        observedAt,
        live: true,
        searchesRecorded: 0,
        httpStatus,
      });

      let provider_status = result.provider_status;
      if (httpStatus === 429) {
        provider_status = ProviderStatus.PROVIDER_RATE_LIMITED;
      } else if (httpStatus >= 500 || httpStatus === 401 || httpStatus === 403) {
        provider_status = ProviderStatus.PROVIDER_ERROR;
      }

      this.usage.record({
        at: observedAt,
        engine: "google_shopping",
        query: queryLabel,
        live: true,
        http_status: httpStatus,
        provider_status,
        shoprs_used: Boolean(resolved.shoprs),
      });

      return {
        ...result,
        provider_status,
        searches_recorded: this.usage.getCount(),
        error_message: result.error_message
          ? redactSecrets(result.error_message, this.apiKey)
          : undefined,
      };
    } catch (error) {
      const redacted = redactError(error, this.apiKey);
      const aborted =
        (error instanceof Error && error.name === "AbortError") ||
        (typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error as { name: string }).name === "AbortError");

      const provider_status = ProviderStatus.PROVIDER_ERROR;

      this.usage.record({
        at: observedAt,
        engine: "google_shopping",
        query: queryLabel,
        live: true,
        http_status: httpStatus,
        provider_status,
        error_class: aborted ? "timeout" : "network_error",
        shoprs_used: Boolean(resolved.shoprs),
      });

      return {
        provider: "SerpApi",
        engine: "google_shopping",
        provider_status,
        query: resolved,
        observed_at: observedAt,
        offers: [],
        target_offers: [],
        filters: [],
        target_shoprs_tokens: [],
        error_message: aborted
          ? `SerpApi request timed out after ${timeoutMs}ms`
          : redactSecrets("SerpApi network error", this.apiKey),
        raw_result_hash: hashRawPayload({ error: redacted }),
        live: true,
        searches_recorded: this.usage.getCount(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveQuery(query: SerpApiShoppingQuery) {
    return {
      q: (query.q ?? "").trim(),
      shoprs: query.shoprs?.trim() || undefined,
      gl: (query.gl ?? "us").toLowerCase(),
      hl: (query.hl ?? "en").toLowerCase(),
      location: query.location ?? "Austin, Texas, United States",
      device: query.device ?? ("desktop" as const),
      no_cache: query.no_cache === true,
    };
  }

  private buildUrl(
    resolved: ReturnType<SerpApiShoppingClient["resolveQuery"]>,
  ): string {
    const params = new URLSearchParams({
      engine: "google_shopping",
      gl: resolved.gl,
      hl: resolved.hl,
      location: resolved.location,
      device: resolved.device,
      api_key: this.apiKey,
    });
    if (resolved.q) {
      params.set("q", resolved.q);
    }
    if (resolved.shoprs) {
      params.set("shoprs", resolved.shoprs);
    }
    if (resolved.no_cache) {
      params.set("no_cache", "true");
    }
    return `${this.baseUrl}?${params.toString()}`;
  }
}

export function createSerpApiClientFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  overrides: Partial<SerpApiClientOptions> = {},
): SerpApiShoppingClient | null {
  // Vercel injects Production env vars at runtime; empty/whitespace = not configured
  const key = (env.SERPAPI_API_KEY ?? env.SERP_API_KEY ?? "").trim();
  if (!key) return null;
  return new SerpApiShoppingClient({ apiKey: key, ...overrides });
}

/** Boolean-only readiness check for health endpoints (never returns the key). */
export function isSerpApiConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return Boolean((env.SERPAPI_API_KEY ?? env.SERP_API_KEY ?? "").trim());
}
