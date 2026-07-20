/**
 * Lane 7.4C — free agent-native discovery, confirmation, consent and
 * monitoring preflight.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import { createSqliteAuthStore, resetAuthStoreCache } from "../../src/auth/auth-store.js";
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
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
} from "../../src/matching/index.js";
import { MONITORING_PAYMENT_READY_STATUS } from "../../src/matching/store.js";
import { selectActivePurchases } from "../../src/monitoring/index.js";
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
    if (!badAuth.ok && "status" in badAuth) {
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
    if (!missingConsent.ok && "status" in missingConsent) {
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
    if (!unsupportedResult.ok && "status" in unsupportedResult) {
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
    if (!ambiguousResult.ok && "status" in ambiguousResult) {
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
    if (!expiredResult.ok && "status" in expiredResult) {
      expect(expiredResult.status).toBe("CONNECTION_EXPIRED");
      expect(expiredResult.http_status).toBe(404);
    }
    expect(quoteCount()).toBe(0);
    // The unsupported (Alaska) scenario legitimately materializes a purchase
    // row before eligibility is checked (per the required ordering); the
    // ambiguous and expired scenarios never reach materialization at all.
    expect(purchaseCount()).toBe(1);
  });

  it("supported PREFLIGHT_MONITORING creates a fingerprint and quote but never MONITORING_ACTIVE, and the scheduler cannot select it", async () => {
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
      .prepare(`SELECT id, user_ref, fingerprint_id, status FROM purchases`)
      .get() as {
      id: string;
      user_ref: string;
      fingerprint_id: string | null;
      status: string;
    };
    expect(purchaseRow.user_ref).toMatch(/^acct_/);
    expect(purchaseRow.fingerprint_id).toBeTruthy();
    // Lane 7.4C.1: fingerprint locked, but never activated — a truthful
    // pre-payment status, never MONITORING_ACTIVE.
    expect(purchaseRow.status).toBe(MONITORING_PAYMENT_READY_STATUS);
    expect(purchaseRow.status).not.toBe("MONITORING_ACTIVE");

    // The scheduler's own selection function must not pick this purchase up.
    const allRows = db
      .prepare(
        `SELECT id, status, purchase_price, currency, purchase_date, purchase_channel,
                country, region, fingerprint_id, monitoring_deadline, is_target_plus,
                known_exclusion
         FROM purchases`,
      )
      .all() as Array<{
      id: string;
      status: string;
      purchase_price: number;
      currency: string;
      purchase_date: string;
      purchase_channel: string;
      country: string;
      region: string | null;
      fingerprint_id: string | null;
      monitoring_deadline: string | null;
      is_target_plus: number;
      known_exclusion: string | null;
    }>;
    const selected = selectActivePurchases(allRows, new Date().toISOString());
    expect(selected.some((p) => p.id === purchaseRow.id)).toBe(false);
  });

  it("recovers on retry when purchase insertion fails after a successful session reservation (crash simulation)", async () => {
    const verified = await establishConnection("preflight-recovery@example.com");
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

    // Simulate a crash between session reservation and purchase insertion:
    // reserve the session for a purchase id that is never actually inserted.
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const crashPurchaseId = "pur_crashsimulated01";
    const reserved = await store.reserveDiscoverySessionMaterialization({
      sessionId: discovery.discovery_session_id,
      purchaseId: crashPurchaseId,
    });
    expect(reserved).toBe(true);
    expect(purchaseCount()).toBe(0); // reservation alone creates no row

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
    expect(purchaseCount()).toBe(1);
    expect(quoteCount()).toBe(1);
    const row = db
      .prepare(`SELECT id, status FROM purchases`)
      .get() as { id: string; status: string };
    expect(row.id).toBe(crashPurchaseId);
    expect(row.status).not.toBe("MONITORING_ACTIVE");
  });

  it("quote issuance failure never activates monitoring and creates no duplicate", async () => {
    const verified = await establishConnection("preflight-quotefail@example.com");
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

    const first = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: discovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Force the existing quote into an unusable state: still "issued" (so it
    // occupies the one-active-quote-per-purchase unique index) but expired
    // (so the idempotent lookup no longer treats it as reusable). A retry
    // must then fail to mint a new quote and fail closed, never silently
    // activating monitoring.
    db.prepare(
      `UPDATE monitoring_enrollment_quotes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`,
    ).run(first.quote_id);

    const retry = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: discovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok && "error" in retry) {
      expect(retry.error).toBe("quote_issuance_failed");
      expect(retry.http_status).toBe(503);
    }

    expect(purchaseCount()).toBe(1);
    expect(quoteCount()).toBe(1); // the old (now-expired) quote only — no new one
    const purchaseRow = db
      .prepare(`SELECT status FROM purchases`)
      .get() as { status: string };
    expect(purchaseRow.status).not.toBe("MONITORING_ACTIVE");
  });

  it("existing web confirmation flow still activates monitoring normally (unchanged)", () => {
    const purchaseId = "pur_web_unchanged_01";
    db.prepare(
      `INSERT INTO purchases (
        id, user_ref, target_product_url, purchase_price, currency, purchase_date,
        country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
        is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      purchaseId,
      "usr_webtest0000000000000000000000",
      "https://www.target.com/p/example-widget/-/A-87654321",
      12.99,
      "USD",
      "2026-07-01",
      "US",
      "TX",
      "target_online",
      "WDG-100",
      null,
      "87654321",
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      null,
      "2026-07-13T00:00:00.000Z",
      "2026-07-13T00:00:00.000Z",
    );

    const purchase = {
      purchase_id: purchaseId,
      target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
      target_item_id: "87654321",
      model_number: "WDG-100",
      product_title: "Example Widget",
    };
    const offer = targetOffer({ offer_id: "web1" });
    const evaluation = evaluateProductMatches(purchase, [offer]);
    expect(evaluation.exact_candidate).toBeDefined();

    const fp = confirmAndPersistLockedFingerprint({
      db,
      purchase,
      candidate: evaluation.exact_candidate!,
      confirmed_at: "2026-07-13T19:00:00.000Z",
    });
    expect(fp.fingerprint_id).toBeTruthy();

    const row = db
      .prepare(`SELECT status, fingerprint_id FROM purchases WHERE id = ?`)
      .get(purchaseId) as { status: string; fingerprint_id: string };
    expect(row.status).toBe("MONITORING_ACTIVE");
    expect(row.fingerprint_id).toBe(fp.fingerprint_id);
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
