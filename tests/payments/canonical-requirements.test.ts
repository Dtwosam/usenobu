/**
 * Canonical PaymentRequirements deep equality: challenge === verify === settle.
 */
import { describe, expect, it } from "vitest";
import {
  buildCanonicalPaymentRequirements,
  buildCanonicalPaymentRequired,
  paymentRequirementsDeepEqual,
} from "../../src/payments/canonical-requirements.js";
import {
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_MAX_TIMEOUT_SECONDS,
  X402_VERSION,
} from "../../src/payments/x402.js";
import { createOkxSellerVerifier } from "../../src/payments/okx-seller-verifier.js";
import type { OkxHttpFetch } from "../../src/payments/okx-seller-client.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const RESOURCE = "https://www.usenobu.xyz/v1/agent/monitoring-pass";

/** Official-shaped signed payload fixture (not invented from Nobu interfaces). */
function officialShapedPayloadHeader(requirements: {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}): string {
  const payload = {
    x402Version: 2,
    resource: {
      url: RESOURCE,
      description: "Nobu Monitoring Pass",
      mimeType: "application/json",
    },
    accepted: {
      scheme: requirements.scheme,
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.amount,
      payTo: requirements.payTo,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: requirements.extra,
    },
    payload: {
      signature: "0x" + "ab".repeat(65),
      authorization: {
        from: "0xbuyer0000000000000000000000000000000001",
        to: requirements.payTo,
        value: requirements.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: "0x" + "11".repeat(32),
      },
    },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("canonical PaymentRequirements", () => {
  it("ExactEvmScheme-enhanced requirements use official eip155:196 extra", async () => {
    const req = await buildCanonicalPaymentRequirements({ payTo: PAY_TO });
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe(DEFAULT_SETTLEMENT_NETWORK);
    expect(req.asset.toLowerCase()).toBe(DEFAULT_SETTLEMENT_ASSET.toLowerCase());
    expect(req.amount).toBe(MONITORING_PRICE_ATOMIC_UNITS);
    expect(req.payTo).toBe(PAY_TO);
    expect(req.maxTimeoutSeconds).toBe(X402_MAX_TIMEOUT_SECONDS);
    // Official package getDefaultAsset version is "1" (not manual "2")
    expect(req.extra.name).toBe("USD₮0");
    expect(req.extra.version).toBe("1");
    // Official PaymentRequirements has no resource field
    expect((req as { resource?: unknown }).resource).toBeUndefined();
  });

  it("challenge.accepts[0] deep-equals requirements sent to verify and settle", async () => {
    const { paymentRequired, requirements } =
      await buildCanonicalPaymentRequired({
        resourceUrl: RESOURCE,
        description: "Nobu Monitoring Pass",
        payTo: PAY_TO,
      });
    expect(paymentRequired.x402Version).toBe(X402_VERSION);
    expect(paymentRequirementsDeepEqual(paymentRequired.accepts[0]!, requirements)).toBe(
      true,
    );

    const captured: Array<{ path: string; body: unknown }> = [];
    const fetchImpl: OkxHttpFetch = async (url, init) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      let body: unknown = null;
      if (init.body) body = JSON.parse(String(init.body));
      captured.push({ path, body });
      if (path.includes("verify")) {
        return new Response(
          JSON.stringify({
            code: "0",
            data: { isValid: true, payer: "0xbuyer" },
          }),
          { status: 200 },
        );
      }
      if (path.includes("settle") && !path.includes("status")) {
        return new Response(
          JSON.stringify({
            code: "0",
            data: {
              success: true,
              status: "success",
              transaction: "0xtx_canonical_eq",
              network: DEFAULT_SETTLEMENT_NETWORK,
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ code: "0", data: {} }), {
        status: 200,
      });
    };

    const seller = createOkxSellerVerifier({
      env: {
        NOBU_AUTH_TEST_MODE: "1",
        OKX_API_KEY: "k",
        OKX_SECRET_KEY: "s",
        OKX_PASSPHRASE: "p",
        OKX_PAY_TO: PAY_TO,
        OKX_BASE_URL: "https://web3.okx.com",
      },
      fetchImpl,
    });

    const header = officialShapedPayloadHeader(requirements);
    const outcome = await seller.verifyAndSettleDetailed({
      resource: RESOURCE,
      authorizationHeader: header,
      requirements,
    });
    expect(outcome.ok).toBe(true);

    const verifyCall = captured.find((c) => c.path.includes("/verify"));
    const settleCall = captured.find(
      (c) => c.path.includes("/settle") && !c.path.includes("status"),
    );
    expect(verifyCall).toBeTruthy();
    expect(settleCall).toBeTruthy();
    const verifyReqs = (verifyCall!.body as { paymentRequirements: unknown })
      .paymentRequirements as Record<string, unknown>;
    const settleReqs = (settleCall!.body as { paymentRequirements: unknown })
      .paymentRequirements as Record<string, unknown>;

    expect(paymentRequirementsDeepEqual(requirements, verifyReqs as never)).toBe(
      true,
    );
    expect(paymentRequirementsDeepEqual(requirements, settleReqs as never)).toBe(
      true,
    );
    expect(paymentRequirementsDeepEqual(verifyReqs as never, settleReqs as never)).toBe(
      true,
    );
    // Nested extra identical
    expect(verifyReqs.extra).toEqual(requirements.extra);
    expect(settleReqs.extra).toEqual(requirements.extra);
  });
});
