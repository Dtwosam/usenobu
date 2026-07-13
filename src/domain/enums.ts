import { z } from "zod";

/**
 * Locked product / purchase result statuses (master spec §8 + OpenAPI response).
 * MONITORING_ACTIVE is product-state only (not A2MCP response enum).
 */
export const ResultStatus = {
  MONITORING_ACTIVE: "MONITORING_ACTIVE",
  PRICE_DROP_DETECTED: "PRICE_DROP_DETECTED",
  POTENTIALLY_ELIGIBLE: "POTENTIALLY_ELIGIBLE",
  NO_PRICE_DROP: "NO_PRICE_DROP",
  WINDOW_EXPIRED: "WINDOW_EXPIRED",
  MATCH_REVIEW_REQUIRED: "MATCH_REVIEW_REQUIRED",
  NO_RELIABLE_PRICE: "NO_RELIABLE_PRICE",
  POLICY_EXCLUSION: "POLICY_EXCLUSION",
  UNSUPPORTED_PURCHASE: "UNSUPPORTED_PURCHASE",
  POLICY_STALE: "POLICY_STALE",
  DATA_SOURCE_UNAVAILABLE: "DATA_SOURCE_UNAVAILABLE",
} as const;

export type ResultStatus = (typeof ResultStatus)[keyof typeof ResultStatus];

export const ResultStatusSchema = z.nativeEnum(ResultStatus);

/** Locked A2MCP / check response statuses (OpenAPI TargetPriceCheckResponse). */
export const CheckResultStatus = {
  PRICE_DROP_DETECTED: "PRICE_DROP_DETECTED",
  POTENTIALLY_ELIGIBLE: "POTENTIALLY_ELIGIBLE",
  NO_PRICE_DROP: "NO_PRICE_DROP",
  WINDOW_EXPIRED: "WINDOW_EXPIRED",
  MATCH_REVIEW_REQUIRED: "MATCH_REVIEW_REQUIRED",
  NO_RELIABLE_PRICE: "NO_RELIABLE_PRICE",
  POLICY_EXCLUSION: "POLICY_EXCLUSION",
  UNSUPPORTED_PURCHASE: "UNSUPPORTED_PURCHASE",
  POLICY_STALE: "POLICY_STALE",
  DATA_SOURCE_UNAVAILABLE: "DATA_SOURCE_UNAVAILABLE",
} as const;

export type CheckResultStatus =
  (typeof CheckResultStatus)[keyof typeof CheckResultStatus];

export const CheckResultStatusSchema = z.nativeEnum(CheckResultStatus);

/** SerpApi provider observation statuses (data contract). */
export const ProviderStatus = {
  LIVE_TARGET_MATCH: "LIVE_TARGET_MATCH",
  TARGET_CANDIDATE_REVIEW: "TARGET_CANDIDATE_REVIEW",
  NO_TARGET_RESULT: "NO_TARGET_RESULT",
  AMBIGUOUS_TARGET_RESULTS: "AMBIGUOUS_TARGET_RESULTS",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  STALE_RESULT: "STALE_RESULT",
} as const;

export type ProviderStatus = (typeof ProviderStatus)[keyof typeof ProviderStatus];

export const ProviderStatusSchema = z.nativeEnum(ProviderStatus);

/** Price provenance classification — never official Target API. */
export const PriceSourceType = {
  THIRD_PARTY_SEARCH_OBSERVATION: "THIRD_PARTY_SEARCH_OBSERVATION",
  USER_PROVIDED_PURCHASE: "USER_PROVIDED_PURCHASE",
  DERIVED_CALCULATION: "DERIVED_CALCULATION",
  OFFICIAL_RETAILER_POLICY: "OFFICIAL_RETAILER_POLICY",
  UNVERIFIED: "UNVERIFIED",
} as const;

export type PriceSourceType =
  (typeof PriceSourceType)[keyof typeof PriceSourceType];

export const PriceSourceTypeSchema = z.nativeEnum(PriceSourceType);

/** MVP purchase channel — Target online only. */
export const PurchaseChannel = {
  TARGET_ONLINE: "target_online",
} as const;

export type PurchaseChannel =
  (typeof PurchaseChannel)[keyof typeof PurchaseChannel];

export const PurchaseChannelSchema = z.nativeEnum(PurchaseChannel);

/** MVP currency and country locks. */
export const CurrencyCode = {
  USD: "USD",
} as const;

export type CurrencyCode = (typeof CurrencyCode)[keyof typeof CurrencyCode];

export const CurrencyCodeSchema = z.nativeEnum(CurrencyCode);

export const CountryCode = {
  US: "US",
} as const;

export type CountryCode = (typeof CountryCode)[keyof typeof CountryCode];

export const CountryCodeSchema = z.nativeEnum(CountryCode);

/** Seller identity for matching — Target only in MVP; Target Plus is never a valid locked seller. */
export const SellerKind = {
  TARGET: "target",
  TARGET_PLUS: "target_plus",
  OTHER: "other",
  UNKNOWN: "unknown",
} as const;

export type SellerKind = (typeof SellerKind)[keyof typeof SellerKind];

export const SellerKindSchema = z.nativeEnum(SellerKind);

/** Product match lifecycle for confirmed vs candidate rows. */
export const MatchLifecycle = {
  CANDIDATE: "candidate",
  USER_CONFIRMED: "user_confirmed",
  LOCKED: "locked",
  REJECTED: "rejected",
} as const;

export type MatchLifecycle = (typeof MatchLifecycle)[keyof typeof MatchLifecycle];

export const MatchLifecycleSchema = z.nativeEnum(MatchLifecycle);

export const PriceProvider = {
  SERPAPI: "SerpApi",
} as const;

export type PriceProvider = (typeof PriceProvider)[keyof typeof PriceProvider];

export const PriceProviderSchema = z.nativeEnum(PriceProvider);

export const SearchEngine = {
  GOOGLE_SHOPPING: "google_shopping",
} as const;

export type SearchEngine = (typeof SearchEngine)[keyof typeof SearchEngine];

export const SearchEngineSchema = z.nativeEnum(SearchEngine);

export const FinalDecisionBy = {
  TARGET: "Target",
} as const;

export type FinalDecisionBy =
  (typeof FinalDecisionBy)[keyof typeof FinalDecisionBy];

export const FinalDecisionBySchema = z.nativeEnum(FinalDecisionBy);

export const POLICY_ID_TARGET_US_V1 = "target-us-online-price-match-v1" as const;
