import { describe, expect, it } from "vitest";
import {
  CheckResultStatus,
  CheckResultStatusSchema,
  CountryCode,
  CountryCodeSchema,
  CurrencyCode,
  CurrencyCodeSchema,
  FinalDecisionBy,
  FinalDecisionBySchema,
  MatchLifecycle,
  MatchLifecycleSchema,
  POLICY_ID_TARGET_US_V1,
  PriceProvider,
  PriceProviderSchema,
  PriceSourceType,
  PriceSourceTypeSchema,
  ProviderStatus,
  ProviderStatusSchema,
  PurchaseChannel,
  PurchaseChannelSchema,
  ResultStatus,
  ResultStatusSchema,
  SearchEngine,
  SearchEngineSchema,
  SellerKind,
  SellerKindSchema,
} from "../../src/domain/index.js";

function expectAllValuesParse<T extends Record<string, string>>(
  enumObject: T,
  schema: { parse: (v: unknown) => string },
): void {
  for (const value of Object.values(enumObject)) {
    expect(schema.parse(value)).toBe(value);
  }
}

describe("locked enums", () => {
  it("accepts every ResultStatus value", () => {
    expectAllValuesParse(ResultStatus, ResultStatusSchema);
    expect(Object.keys(ResultStatus)).toHaveLength(11);
  });

  it("accepts every CheckResultStatus value", () => {
    expectAllValuesParse(CheckResultStatus, CheckResultStatusSchema);
    expect(Object.keys(CheckResultStatus)).toHaveLength(10);
    expect(CheckResultStatusSchema.safeParse("MONITORING_ACTIVE").success).toBe(
      false,
    );
  });

  it("accepts every ProviderStatus value", () => {
    expectAllValuesParse(ProviderStatus, ProviderStatusSchema);
    expect(Object.keys(ProviderStatus)).toHaveLength(7);
  });

  it("accepts every PriceSourceType value", () => {
    expectAllValuesParse(PriceSourceType, PriceSourceTypeSchema);
  });

  it("locks purchase channel, currency, country, provider, engine", () => {
    expectAllValuesParse(PurchaseChannel, PurchaseChannelSchema);
    expectAllValuesParse(CurrencyCode, CurrencyCodeSchema);
    expectAllValuesParse(CountryCode, CountryCodeSchema);
    expectAllValuesParse(PriceProvider, PriceProviderSchema);
    expectAllValuesParse(SearchEngine, SearchEngineSchema);
    expectAllValuesParse(FinalDecisionBy, FinalDecisionBySchema);
    expectAllValuesParse(SellerKind, SellerKindSchema);
    expectAllValuesParse(MatchLifecycle, MatchLifecycleSchema);

    expect(PurchaseChannelSchema.safeParse("in_store").success).toBe(false);
    expect(CurrencyCodeSchema.safeParse("EUR").success).toBe(false);
    expect(CountryCodeSchema.safeParse("CA").success).toBe(false);
    expect(PriceProviderSchema.safeParse("TargetAPI").success).toBe(false);
  });

  it("locks policy id constant", () => {
    expect(POLICY_ID_TARGET_US_V1).toBe("target-us-online-price-match-v1");
  });

  it("rejects unknown enum garbage", () => {
    expect(ResultStatusSchema.safeParse("REFUND_GUARANTEED").success).toBe(
      false,
    );
    expect(ProviderStatusSchema.safeParse("OFFICIAL_TARGET_PRICE").success).toBe(
      false,
    );
  });
});
