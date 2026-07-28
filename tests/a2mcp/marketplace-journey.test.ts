import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recentPurchaseDate } from "../helpers/test-dates.js";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import { getAuthStore, resetAuthStoreCache } from "../../src/auth/auth-store.js";
import {
  clearCapturedAgentEmailCodes,
  peekCapturedAgentEmailCode,
} from "../../src/auth/email.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import { runMarketplaceJourney } from "../../src/a2mcp/marketplace-journey.js";
import { POST as paidServicePost } from "../../app/v1/agent/monitoring-pass/route.js";
import { reconcilePendingPassSettlements } from "../../src/payments/monitoring-pass-service.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import type { OkxHttpFetch } from "../../src/payments/okx-seller-client.js";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-marketplace-journey-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function targetOffer(): MatchableOffer {
  return {
    offer_id: "marketplace-proof-offer",
    title: "Example Gadget WDG-100",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-gadget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: 19.99,
    currency: "USD",
    serpapi_product_id: "marketplace-proof-product",
  };
}

function assertIncomplete(
  body: Record<string, unknown>,
  stageFields: string | string[],
): void {
  const expectedFields = Array.isArray(stageFields) ? stageFields : [stageFields];
  expect(body.status).toBe("input_required");
  expect(body.fields).toEqual([...expectedFields, "journey_id"]);
  expect(body.requiredArgs).toEqual([...expectedFields, "journey_id"]);
  expect(body.journey_id).toBeTruthy();
  expect(body.second_payment_required).toBe(false);
  expect(body.monitoring_active).toBe(false);
  expect(body.journey_complete).toBe(false);
  expect(body.payment_status).toBe("recognized");
  expect(body.retry_safe).toBe(true);
  expect(String(body.guidance || "").length).toBeGreaterThan(0);
  // Marketplace journey never exposes free-service action enums as required next steps.
  expect(JSON.stringify(body.fields)).not.toMatch(/UNDERSTAND_|RESOLVE_|REDEEM_/);
}

describe("Lane 8R marketplace Purchase Setup", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedAgentEmailCodes();
    resetAuthStoreCache();
    resetWebDatabaseCache();
    db = openDatabase(dbPath);
    migrateUp(db);
    await getAuthStore({ sqliteDb: db });
  });

  afterEach(() => {
    db.close();
    resetWebDatabaseCache();
    resetAuthStoreCache();
    clearCapturedAgentEmailCodes();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      // Best-effort test cleanup only.
    }
  });

  function seedIssuedPass(seed: string): { passId: string; continuationId: string } {
    const nowIso = new Date().toISOString();
    const paymentId = `pay_${seed}`;
    const passId = `pass_${seed}_1234567890abcdef`;
    const continuationId = `pass_cont_${seed}_1234567890abcdef`;
    db.prepare(
      `INSERT INTO monitoring_pass_payments
       (id, authorization_digest, status, settlement_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(paymentId, sha256Hex(`auth-${seed}`), "settled", `settled-${seed}`, nowIso, nowIso);
    db.prepare(
      `INSERT INTO monitoring_passes
       (id, pass_token_hash, settlement_ref, payment_id, price_amount, price_currency,
        status, created_at, updated_at)
       VALUES (?,?,?,?,0.99,'USD','issued',?,?)`,
    ).run(passId, sha256Hex(`token-${seed}`), `settled-${seed}`, paymentId, nowIso, nowIso);
    db.prepare(
      `INSERT INTO monitoring_pass_continuations
       (id, payment_id, monitoring_pass_id, status, created_at, updated_at)
       VALUES (?,?,?,'issued',?,?)`,
    ).run(continuationId, paymentId, passId, nowIso, nowIso);
    return { passId, continuationId };
  }

  function passCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_passes`).get() as { c: number }).c;
  }

  it("happy path resolves a pass and activates only after every ordered stage", async () => {
    const { passId } = seedIssuedPass("happy");
    const deps = {
      sqliteDb: db,
      forceDeterministic: true,
      offersOverride: [targetOffer()],
      sourceKey: "focused-happy-path",
    };

    const resolved = await runMarketplaceJourney({ monitoring_pass_id: passId }, deps);
    expect(resolved.http_status).toBe(400);
    assertIncomplete(resolved.body, "confirm_use_pass");
    expect(String(resolved.body.message)).toContain("No additional payment");
    const journeyId = String(resolved.body.journey_id);

    const confirmedUse = await runMarketplaceJourney(
      { journey_id: journeyId, confirm_use_pass: true },
      deps,
    );
    assertIncomplete(confirmedUse.body, "purchase_description");

    const purchaseDescription = [
      "I bought an Example Gadget from Target online",
      `on ${recentPurchaseDate()} for $24.99 in TX,`,
      "model WDG-100,",
      "https://www.target.com/p/example-gadget/-/A-87654321",
    ].join(" ");
    const discovered = await runMarketplaceJourney(
      { journey_id: journeyId, purchase_description: purchaseDescription },
      deps,
    );
    assertIncomplete(discovered.body, "candidate_id");
    const candidateId = String(discovered.body.message).match(/cand_[a-zA-Z0-9_-]+/)?.[0];
    expect(candidateId).toBeTruthy();

    const candidate = await runMarketplaceJourney(
      { journey_id: journeyId, candidate_id: candidateId },
      deps,
    );
    assertIncomplete(candidate.body, "email");

    const email = await runMarketplaceJourney(
      { journey_id: journeyId, email: "marketplace-proof@example.com" },
      deps,
    );
    assertIncomplete(email.body, "verification_code");
    const store = await getAuthStore({ sqliteDb: db });
    const durableJourney = await store.getMarketplacePurchaseJourneyById(journeyId);
    expect(durableJourney?.connection_id).toBeTruthy();
    const code = peekCapturedAgentEmailCode(durableJourney!.connection_id!);
    expect(code).toMatch(/^\d{6}$/);

    const verified = await runMarketplaceJourney(
      { journey_id: journeyId, verification_code: code },
      deps,
    );
    assertIncomplete(verified.body, [
      "monitoring_consent",
      "email_alert_consent",
    ]);

    const active = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      deps,
    );
    expect(active.http_status).toBe(200);
    expect(active.body.status).toBe("MONITORING_ACTIVE");
    expect(active.body.monitoring_active).toBe(true);
    expect(active.body.second_payment_required).toBe(false);
    // Marketplace complete responses stay free of low-level credential fields.
    expect(JSON.stringify(active.body)).not.toMatch(
      /connection_token|quote_id|discovery_session_id/i,
    );
    expect(
      (db.prepare(`SELECT status FROM monitoring_passes WHERE id = ?`).get(passId) as { status: string }).status,
    ).toBe("redeemed");
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitor_activations`).get() as { c: number }).c,
    ).toBe(1);
  });

  it("safety keeps issued-pass setup free, actionless, and stage ordered", async () => {
    const { passId } = seedIssuedPass("safety");
    const beforePasses = passCount();
    const early = await runMarketplaceJourney(
      {
        monitoring_pass_id: passId,
        email: "too-early@example.com",
        monitoring_consent: true,
        email_alert_consent: true,
      },
      { sqliteDb: db },
    );
    expect(early.http_status).toBe(400);
    assertIncomplete(early.body, "confirm_use_pass");
    const journeyId = String(early.body.journey_id);

    const paidUrlAttempt = await paidServicePost(
      new Request("https://usenobu.vercel.app/v1/agent/monitoring-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitoring_pass_id: passId }),
      }),
    );
    expect(paidUrlAttempt.status).toBe(400);
    assertIncomplete(
      (await paidUrlAttempt.json()) as Record<string, unknown>,
      "confirm_use_pass",
    );

    const purchaseStage = await runMarketplaceJourney(
      { journey_id: journeyId, confirm_use_pass: true },
      { sqliteDb: db },
    );
    assertIncomplete(purchaseStage.body, "purchase_description");
    const stillPurchaseOnly = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        email: "still-too-early@example.com",
        monitoring_consent: true,
        email_alert_consent: true,
      },
      { sqliteDb: db },
    );
    assertIncomplete(stillPurchaseOnly.body, "purchase_description");

    expect(passCount()).toBe(beforePasses);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_pass_payments`).get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM agent_connections`).get() as { c: number }).c,
    ).toBe(0);
    for (const result of [early, purchaseStage, stillPurchaseOnly]) {
      expect(result.http_status).not.toBe(402);
      expect(result.body.second_payment_required).toBe(false);
      expect(result.body.payment_status).toBe("recognized");
      // No free-service action enum / paid re-challenge surface in journey bodies.
      expect(JSON.stringify(result.body)).not.toMatch(
        /supported_actions|UNDERSTAND_PURCHASE|RESOLVE_MONITORING_PASS|REDEEM_MONITORING_PASS/i,
      );
    }
  });

  it("reconciliation issues one pass for a confirmed settlement and zero on replay", async () => {
    const nowIso = new Date().toISOString();
    const paymentId = "pay_latest_recovery_path";
    const pendingRef = "0xpending_latest_recovery_path";
    db.prepare(
      `INSERT INTO monitoring_pass_payments
       (id, authorization_digest, status, settlement_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(paymentId, sha256Hex("latest-recovery-placeholder"), "verifying", pendingRef, nowIso, nowIso);

    let statusCalls = 0;
    const fetchImpl: OkxHttpFetch = async () => {
      statusCalls += 1;
      return new Response(
        JSON.stringify({
          code: "0",
          data: {
            success: true,
            status: "success",
            transaction: "0xconfirmed_latest_recovery_path",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const env = {
      ...process.env,
      OKX_API_KEY: "test-key",
      OKX_SECRET_KEY: "test-secret",
      OKX_PASSPHRASE: "test-pass",
      OKX_PAY_TO: "0x1111111111111111111111111111111111111111",
      OKX_BASE_URL: "https://web3.okx.com",
    };

    const first = await reconcilePendingPassSettlements({ sqliteDb: db, env, fetchImpl });
    const replay = await reconcilePendingPassSettlements({ sqliteDb: db, env, fetchImpl });
    expect(first.issued).toBe(1);
    expect(first.issued_pass_ids).toHaveLength(1);
    expect(replay.issued).toBe(0);
    expect(replay.scanned).toBe(0);
    expect(passCount()).toBe(1);
    expect(statusCalls).toBe(1);
  });
});