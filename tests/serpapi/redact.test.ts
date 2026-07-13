import { describe, expect, it } from "vitest";
import {
  assertNoSecretLeak,
  redactError,
  redactJsonValue,
  redactSecrets,
} from "../../src/serpapi/index.js";

describe("SerpApi secret redaction", () => {
  const key = "test_secret_key_ABCDEFG123456";

  it("redacts api_key query parameters and bare key material", () => {
    const url = `https://serpapi.com/search.json?engine=google_shopping&api_key=${key}&q=test`;
    const out = redactSecrets(url, key);
    expect(out).not.toContain(key);
    expect(out).toContain("[REDACTED");
  });

  it("redacts JSON api_key fields", () => {
    const raw = JSON.stringify({ api_key: key, q: "Target earbuds" });
    const out = redactSecrets(raw, key);
    expect(out).not.toContain(key);
  });

  it("redacts errors including stack-like content", () => {
    const err = new Error(`Failed fetch with api_key=${key}`);
    const out = redactError(err, key);
    expect(out).not.toContain(key);
  });

  it("redactJsonValue removes key material", () => {
    const value = redactJsonValue(
      { url: `https://x.test?api_key=${key}`, nested: { api_key: key } },
      key,
    );
    const text = JSON.stringify(value);
    expect(text).not.toContain(key);
  });

  it("assertNoSecretLeak throws when key present", () => {
    expect(() => assertNoSecretLeak(`token ${key}`, key)).toThrow(/Secret leak/);
  });
});
