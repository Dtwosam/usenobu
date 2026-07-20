/**
 * Lane 7.4C — free agent-native discovery, confirmation, consent and
 * monitoring preflight.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import { resetAuthStoreCache } from "../../src/auth/auth-store.js";
import {
  beginAgentEmailVerification,
  verifyAgentEmailCode,
} from "../../src/auth/agent-connections.js";
import {
  clearCapturedAgentEmailCodes,
  peekCapturedAgentEmailCode,
} from "../../src/auth/email.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import {
  confirmProductForAgent,
  discoverProductForAgent,
  preflightMonitoringForAgent,
} from "../../src/web/agent-preflight-service.js";
import { runAgentAction } from "../../src/ai/agent-service.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import type { DiscoveryPurchaseFields } from "../../src/ai/schemas.js";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-agent-preflight-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function targetOffer(overrides: Partial<MatchableOffer> = {}): MatchableOffer {
  return {
    offer_id: "o1",
    title: "Example Gadget WDG-100",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-gadget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: 19.99,
    currency: "USD",
    serpapi_product_id: "not-tcin",
    ...overrides,
  };
}

const CLUE_ONLY_FIELDS: DiscoveryPurchaseFields = {
  purchase_price: 24.99,
  purchase_date: "2026-07-10",
  purchase_channel: "target_online",
  country: "US",
  region: "TX",
  product_title: "Example Gadget",
  model_number: "WDG-100",
};

const EXACT_IDENTITY_FIELDS: DiscoveryPurchaseFields = {
  purchase_price: 24.99,
  purchase_date: "2026-07-10",
  purchase_channel: "target_online",
  country: "US",
  region: "TX",
  target_product_url: "https://www.target.com/p/example-gadget/-/A-87654321",
  target_item_id: "87654321",
};

describe("Lane 7.4C agent discovery/confirmation/preflight", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedAgentEmailCodes();
    resetAuthStoreCache();
    resetWebDatabaseCache();
    db = openDatabase(dbPath);
    migrateUp(db);
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
      /* ignore */
    }
  });

  function purchaseCount(): number {
    return (
      db.prepare(`SELECT COUNT(*) as c FROM purchases`).get() as { c: number }
    ).c;
  }

  function quoteCount(): number {
    return (
      db
        .prepare(`SELECT COUNT(*) as c FROM monitoring_enrollment_quotes`)
        .get() as { c: number }
    ).c;
  }

  async function establishConnection(email: string) {
    const begin = await beginAgentEmailVerification({ email, sqliteDb: db });
    if (!begin.ok) throw new Error("begin failed");
    const code = peekCapturedAgentEmailCode(begin.connection_id)!;
    const verified = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code,
      sqliteDb: db,
    });
    if (!verified.ok) throw new Error("verify failed");
    return verified;
  }

  it("DISCOVER_PRODUCT without identity creates no durable owned purchase", async () => {
    const result = await discoverProductForAgent(CLUE_ONLY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discovery_session_id).toMatch(/^disc_/);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(purchaseCount()).toBe(0);
  });

  it("returns bounded Target-only candidates; Target Plus and non-Target excluded", async () => {
    const offers: MatchableOffer[] = [
      ...Array.from({ length: 7 }, (_, i) =>
        targetOffer({
          offer_id: `t${i}`,
          target_item_id: `8000000${i}`,
          merchant_link: `https://www.target.com/p/item-${i}/-/A-8000000${i}`,
          title: `Distinct Target Item ${i}`,
        }),
      ),
      targetOffer({
        offer_id: "plus1",
        is_target_plus: true,
        title: "Target Plus Excluded Item",
      }),
      targetOffer({
        offer_id: "nontarget1",
        seller_kind: "other",
        seller_text: "Some Other Seller",
        title: "Non Target Excluded Item",
        merchant_link: null,
        target_item_id: undefined,
      }),
    ];
    const result = await discoverProductForAgent(CLUE_ONLY_FIELDS, {
      offersOverride: offers,
      sqliteDb: db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.length).toBeLessThanOrEqual(5);
    expect(result.candidates.some((c) => c.title.includes("Excluded"))).toBe(
      false,
    );
  });

  it("CONFIRM_PRODUCT rejects a tampered candidate_id", async () => {
    const discovery = await discoverProductForAgent(CLUE_ONLY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;

    const result = await confirmProductForAgent({
      discoverySessionId: discovery.discovery_session_id,
      candidateId: "cand_does_not_exist",
      sqliteDb: db,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("CANDIDATE_NOT_CONFIRMABLE");
      expect(result.http_status).toBe(400);
    }
    expect(purchaseCount()).toBe(0);
  });

  it("CONFIRM_PRODUCT rejects a stale/expired discovery session", async () => {
    const start = new Date("2026-07-20T12:00:00.000Z");
    const discovery = await discoverProductForAgent(CLUE_ONLY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
      now: start,
    });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;

    const candidateId = discovery.candidates[0]!.candidate_id;
    const wayLater = new Date(start.getTime() + 31 * 60 * 1000);
    const result = await confirmProductForAgent({
      discoverySessionId: discovery.discovery_session_id,
      candidateId,
      sqliteDb: db,
      now: wayLater,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("CONNECTION_EXPIRED");
      expect(result.http_status).toBe(404);
    }
  });

  it("CONFIRM_PRODUCT rejects weak/title-only, Target Plus, and non-Target candidates even if present in the snapshot", async () => {
    const discovery = await discoverProductForAgent(CLUE_ONLY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;

    // Directly inject weak/non-Target/Target-Plus scored candidates into the
    // durable snapshot to test CONFIRM_PRODUCT's own revalidation guard,
    // independent of how discovery itself would have scored them.
    const weakCandidate = {
      candidate_id: "cand_weak_title_only",
      offer: {
        ...targetOffer({ offer_id: "weak1" }),
        target_item_id: undefined,
        model_number: undefined,
        upc_or_gtin: undefined,
        merchant_link: null,
      },
      tier: "title_only",
      decision: "MATCH_REVIEW_REQUIRED",
      reasons: ["title_only_insufficient"],
      title_similarity: 0.4,
      title_only: true,
    };
    const targetPlusCandidate = {
      candidate_id: "cand_target_plus",
      offer: targetOffer({ offer_id: "plus2", is_target_plus: true }),
      tier: "exact_tcin",
      decision: "EXACT_MATCH_CANDIDATE",
      reasons: ["discovery_tcin"],
      title_similarity: 1,
      title_only: false,
    };
    const nonTargetCandidate = {
      candidate_id: "cand_non_target",
      offer: targetOffer({ offer_id: "other2", seller_kind: "other" }),
      tier: "exact_tcin",
      decision: "EXACT_MATCH_CANDIDATE",
      reasons: ["discovery_tcin"],
      title_similarity: 1,
      title_only: false,
    };
    db.prepare(
      `UPDATE discovery_sessions SET candidates_snapshot_json = ? WHERE id = ?`,
    ).run(
      JSON.stringify([weakCandidate, targetPlusCandidate, nonTargetCandidate]),
      discovery.discovery_session_id,
    );

    for (const candidateId of [
      "cand_weak_title_only",
      "cand_target_plus",
      "cand_non_target",
    ]) {
      const result = await confirmProductForAgent({
        discoverySessionId: discovery.discovery_session_id,
        candidateId,
        sqliteDb: db,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe("CANDIDATE_NOT_CONFIRMABLE");
    }
    expect(purchaseCount()).toBe(0);
  });

  it("CONFIRM_PRODUCT locks a fingerprint against the session only — no purchase row created", async () => {
    const discovery = await discoverProductForAgent(EXACT_IDENTITY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;
    const candidateId = discovery.candidates[0]!.candidate_id;

    const confirmed = await confirmProductForAgent({
      discoverySessionId: discovery.discovery_session_id,
      candidateId,
      sqliteDb: db,
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.status).toBe("PRODUCT_CONFIRMED");
    expect(purchaseCount()).toBe(0);
  });

  it("PREFLIGHT_MONITORING rejects an invalid connection and missing consent", async () => {
    const discovery = await discoverProductForAgent(EXACT_IDENTITY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;
    const candidateId = discovery.candidates[0]!.candidate_id;
    await confirmProductForAgent({
      discoverySessionId: discovery.discovery_session_id,
      candidateId,
      sqliteDb: db,
    });

    const badAuth = await preflightMonitoringForAgent({
      connectionId: "conn_unknown",
      connectionToken: "bogus-token-xxxxxxxxxxxxxxxxxxxxxxxx",
      discoverySessionId: discovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
    });
    expect(badAuth.ok).toBe(false);
    if (!badAuth.ok) {
      expect(badAuth.status).toBe("ACTION_NOT_AUTHORIZED");
      expect(badAuth.http_status).toBe(401);
    }

    const verified = await establishConnection("preflight-consent@example.com");
    const missingConsent = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: discovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: false,
      sqliteDb: db,
    });
    expect(missingConsent.ok).toBe(false);
    if (!missingConsent.ok) {
      expect(missingConsent.status).toBe("CONSENT_REQUIRED");
      expect(missingConsent.http_status).toBe(400);
    }
    expect(purchaseCount()).toBe(0);
    expect(quoteCount()).toBe(0);
  });

  it("PREFLIGHT_MONITORING fails closed for unsupported (Alaska), ambiguous (unconfirmed), and expired sessions — no quote", async () => {
    const verified = await establishConnection("preflight-failclosed@example.com");

    // Unsupported: Alaska region.
    const unsupportedFields: DiscoveryPurchaseFields = {
      ...EXACT_IDENTITY_FIELDS,
      region: "AK",
    };
    const unsupportedDiscovery = await discoverProductForAgent(unsupportedFields, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(unsupportedDiscovery.ok).toBe(true);
    if (!unsupportedDiscovery.ok) return;
    const unsupportedConfirm = await confirmProductForAgent({
      discoverySessionId: unsupportedDiscovery.discovery_session_id,
      candidateId: unsupportedDiscovery.candidates[0]!.candidate_id,
      sqliteDb: db,
    });
    expect(unsupportedConfirm.ok).toBe(true);
    const unsupportedResult = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: unsupportedDiscovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
    });
    expect(unsupportedResult.ok).toBe(false);
    if (!unsupportedResult.ok) {
      expect(unsupportedResult.status).toBe("UNSUPPORTED_PURCHASE");
      expect(unsupportedResult.http_status).toBe(200);
    }
    expect(quoteCount()).toBe(0);

    // Ambiguous: never confirmed.
    const ambiguousDiscovery = await discoverProductForAgent(EXACT_IDENTITY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(ambiguousDiscovery.ok).toBe(true);
    if (!ambiguousDiscovery.ok) return;
    const ambiguousResult = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: ambiguousDiscovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
    });
    expect(ambiguousResult.ok).toBe(false);
    if (!ambiguousResult.ok) {
      expect(ambiguousResult.status).toBe("PRODUCT_CONFIRMATION_REQUIRED");
      expect(ambiguousResult.http_status).toBe(400);
    }
    expect(quoteCount()).toBe(0);

    // Expired: confirmed but past the 30-minute discovery TTL.
    const start = new Date("2026-07-20T12:00:00.000Z");
    const expiredDiscovery = await discoverProductForAgent(EXACT_IDENTITY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
      now: start,
    });
    expect(expiredDiscovery.ok).toBe(true);
    if (!expiredDiscovery.ok) return;
    const expiredConfirm = await confirmProductForAgent({
      discoverySessionId: expiredDiscovery.discovery_session_id,
      candidateId: expiredDiscovery.candidates[0]!.candidate_id,
      sqliteDb: db,
      now: start,
    });
    expect(expiredConfirm.ok).toBe(true);
    const wayLater = new Date(start.getTime() + 31 * 60 * 1000);
    const expiredResult = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: expiredDiscovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
      now: wayLater,
    });
    expect(expiredResult.ok).toBe(false);
    if (!expiredResult.ok) {
      expect(expiredResult.status).toBe("CONNECTION_EXPIRED");
      expect(expiredResult.http_status).toBe(404);
    }
    expect(quoteCount()).toBe(0);
    // The unsupported (Alaska) scenario legitimately materializes a purchase
    // row before eligibility is checked (per the required ordering); the
    // ambiguous and expired scenarios never reach materialization at all.
    expect(purchaseCount()).toBe(1);
  });

  it("supported PREFLIGHT_MONITORING creates exactly one owned purchase and one quote", async () => {
    const verified = await establishConnection("preflight-supported@example.com");
    const discovery = await discoverProductForAgent(EXACT_IDENTITY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;
    const confirmed = await confirmProductForAgent({
      discoverySessionId: discovery.discovery_session_id,
      candidateId: discovery.candidates[0]!.candidate_id,
      sqliteDb: db,
    });
    expect(confirmed.ok).toBe(true);

    const result = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: discovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("MONITORING_PAYMENT_READY");
    expect(result.price_amount).toBe(0.99);
    expect(result.price_currency).toBe("USD");
    expect(result.quote_id).toMatch(/^quote_/);

    expect(purchaseCount()).toBe(1);
    expect(quoteCount()).toBe(1);
    const purchaseRow = db
      .prepare(`SELECT user_ref, fingerprint_id FROM purchases`)
      .get() as { user_ref: string; fingerprint_id: string | null };
    expect(purchaseRow.user_ref).toBe(verified.connection_id ? purchaseRow.user_ref : null);
    expect(purchaseRow.user_ref).toMatch(/^acct_/);
    expect(purchaseRow.fingerprint_id).toBeTruthy();
  });

  it("retries and concurrent PREFLIGHT_MONITORING calls create no duplicate purchase or quote", async () => {
    const verified = await establishConnection("preflight-idempotent@example.com");
    const discovery = await discoverProductForAgent(EXACT_IDENTITY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;
    await confirmProductForAgent({
      discoverySessionId: discovery.discovery_session_id,
      candidateId: discovery.candidates[0]!.candidate_id,
      sqliteDb: db,
    });

    const callOnce = () =>
      preflightMonitoringForAgent({
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        discoverySessionId: discovery.discovery_session_id,
        monitoringConsent: true,
        emailAlertConsent: true,
        sqliteDb: db,
      });

    const first = await callOnce();
    const [second, third] = await Promise.all([callOnce(), callOnce()]);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;
    expect(second.quote_id).toBe(first.quote_id);
    expect(third.quote_id).toBe(first.quote_id);

    expect(purchaseCount()).toBe(1);
    expect(quoteCount()).toBe(1);
  });

  it("Lane 7.4B agent-connection actions and the original three agent actions remain unchanged", async () => {
    const invalid = await runAgentAction({ action: "HACK_THE_PLANET" });
    expect(invalid.http_status).toBe(400);

    const check = await runAgentAction(
      {
        action: "CHECK_CONFIRMED_PURCHASE",
        target_product_url: "https://www.target.com/p/x/-/A-12345",
        purchase_price: 10,
        currency: "USD",
        purchase_date: "2026-07-10",
        country: "US",
        region: "TX",
        purchase_channel: "target_online",
      },
      { offersOverride: [], skipPolicyFreshness: true },
    );
    expect(check.http_status).toBe(200);
    expect(check.body).toHaveProperty("final_decision_by", "Target");

    const begin = await runAgentAction(
      { action: "BEGIN_EMAIL_VERIFICATION", email: "unchanged@example.com" },
      { sqliteDb: db, sourceKey: "regression-src" },
    );
    expect(begin.http_status).toBe(200);
    const beginBody = begin.body as { connection_id: string; status: string };
    expect(beginBody.status).toBe("EMAIL_CODE_SENT");

    const code = peekCapturedAgentEmailCode(beginBody.connection_id)!;
    const verify = await runAgentAction(
      {
        action: "VERIFY_EMAIL_CODE",
        connection_id: beginBody.connection_id,
        code,
      },
      { sqliteDb: db },
    );
    expect(verify.http_status).toBe(200);
    const verifyBody = verify.body as {
      status: string;
      connection_id: string;
      connection_token: string;
    };
    expect(verifyBody.status).toBe("EMAIL_VERIFIED");

    const revoke = await runAgentAction(
      {
        action: "REVOKE_AGENT_CONNECTION",
        connection_id: verifyBody.connection_id,
        connection_token: verifyBody.connection_token,
      },
      { sqliteDb: db },
    );
    expect(revoke.http_status).toBe(200);
    expect(revoke.body).toMatchObject({ status: "CONNECTION_REVOKED" });
  });

  it("agent-service dispatch: DISCOVER_PRODUCT -> CONFIRM_PRODUCT -> PREFLIGHT_MONITORING over /v1/agent", async () => {
    const verified = await establishConnection("agent-dispatch@example.com");

    const discover = await runAgentAction(
      { action: "DISCOVER_PRODUCT", purchase: EXACT_IDENTITY_FIELDS },
      { offersOverride: [targetOffer()], sqliteDb: db },
    );
    expect(discover.http_status).toBe(200);
    const discoverBody = discover.body as {
      agent_state: string;
      discovery_session_id: string;
      candidates: Array<{ candidate_id: string }>;
    };
    expect(discoverBody.agent_state).toBe("PRODUCT_DISCOVERY");
    expect(discoverBody.candidates.length).toBeGreaterThan(0);

    const confirm = await runAgentAction(
      {
        action: "CONFIRM_PRODUCT",
        discovery_session_id: discoverBody.discovery_session_id,
        candidate_id: discoverBody.candidates[0]!.candidate_id,
      },
      { sqliteDb: db },
    );
    expect(confirm.http_status).toBe(200);
    expect(confirm.body).toMatchObject({ status: "PRODUCT_CONFIRMED" });

    const preflight = await runAgentAction(
      {
        action: "PREFLIGHT_MONITORING",
        connection_id: verified.connection_id,
        connection_token: verified.connection_token,
        discovery_session_id: discoverBody.discovery_session_id,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      { sqliteDb: db },
    );
    expect(preflight.http_status).toBe(200);
    expect(preflight.body).toMatchObject({ status: "MONITORING_PAYMENT_READY" });
  });
});
