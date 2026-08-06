/**
 * Generic buyer-agent A-to-Z proof (buyer interoperability repair).
 *
 * The agent knows only:
 *   required_fields | input_required | automatic_continue | protocol_continuation
 *   | interaction
 *
 * It never asks the user for machine-owned IDs/tokens and never invents a
 * second payment. One mocked settlement → journey ensured → MONITORING_ACTIVE.
 * New paid responses never contain pass_claim_credential.
 */
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
import {
  monitoringPassForAgent,
  monitoringPassResponseBody,
} from "../../src/payments/monitoring-pass-service.js";
import type { X402Verifier } from "../../src/payments/x402.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import { DEFAULT_FREE_SERVICE_ENDPOINT } from "../../src/a2mcp/service-catalogue.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import { derivePassClaimCredential } from "../../src/payments/claim-credential.js";

const CANONICAL = "www.usenobu.xyz";
// Reconstruct obsolete generated alias without embedding the literal hostname.
const OBSOLETE_HOST = ["usenobu", "vercel", "app"].join(".");

const MACHINE_OWNED = [
  "pass_continuation_id",
  "pass_claim_credential",
  "journey_id",
  "discovery_session_id",
  "connection_id",
  "connection_token",
  "quote_id",
  "monitoring_pass_id",
];

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-generic-buyer-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function targetOffer(): MatchableOffer {
  return {
    offer_id: "generic-buyer-offer",
    title: "Example Gadget WDG-100",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-gadget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: 19.99,
    currency: "USD",
    serpapi_product_id: "generic-buyer-product",
  };
}

function acceptingVerifier(settlementRef: string): X402Verifier {
  return {
    label: "test-fake-accept-generic-buyer",
    async verifyPayment() {
      return { ok: true, settlementRef, verifiedVia: "test-fake" };
    },
  };
}

type ProtocolContinuation = {
  method: "POST";
  endpoint: string;
  service_id: number;
  body: Record<string, unknown>;
  user_input_fields: string[];
  machine_fields: string[];
  sensitive_fields: string[];
};

type AgentView = {
  status?: string;
  input_required?: boolean;
  automatic_continue?: boolean;
  required_fields?: string[] | null;
  fields?: string[] | null;
  protocol_continuation?: ProtocolContinuation | null;
  machine_continuation?: ProtocolContinuation | null;
  monitoring_active?: boolean;
  journey_complete?: boolean;
  second_payment_required?: boolean;
  payment_status?: string;
  message?: string;
  journey_id?: string;
  monitoring_pass_id?: string;
  pass_continuation_id?: string;
  current_step?: string;
  interaction?: {
    mode: string;
    fields: string[];
    confirmation_required: boolean;
  };
  guidance?: string;
};

/** Generic buyer agent: only follows the contract surfaces. */
async function followContinuation(
  body: AgentView,
  deps: {
    sqliteDb: ReturnType<typeof openDatabase>;
    forceDeterministic: boolean;
    offersOverride: MatchableOffer[];
    sourceKey: string;
  },
  userAnswers: Record<string, unknown>,
  log: string[],
): Promise<AgentView> {
  const cont = body.protocol_continuation;
  if (!cont) {
    throw new Error(`no protocol_continuation for status=${body.status}`);
  }
  expect(cont.method).toBe("POST");
  expect(cont.endpoint).toContain(CANONICAL);
  expect(cont.endpoint).not.toContain(OBSOLETE_HOST);
  expect(cont.service_id).toBe(33561);
  // Neutral metadata only — no imperative agent-control flags.
  expect((cont as Record<string, unknown>).do_not_ask_user).toBeUndefined();
  expect((cont as Record<string, unknown>).do_not_display).toBeUndefined();
  expect(Array.isArray(cont.user_input_fields)).toBe(true);
  expect(Array.isArray(cont.machine_fields)).toBe(true);
  expect(Array.isArray(cont.sensitive_fields)).toBe(true);

  const msg = String(body.message || "");
  for (const s of cont.sensitive_fields || []) {
    const secret = cont.body[s];
    if (typeof secret === "string" && secret.length > 0) {
      expect(msg).not.toContain(secret);
    }
  }

  const postBody: Record<string, unknown> = { ...cont.body };

  if (body.automatic_continue && !body.input_required) {
    log.push(`auto:${body.status || "auto"}`);
    const result = await runMarketplaceJourney(postBody, deps);
    expect(result.http_status).toBe(200);
    return result.body as AgentView;
  }

  if (body.input_required) {
    const required = body.required_fields || body.fields || [];
    for (const field of required) {
      expect(MACHINE_OWNED).not.toContain(field);
      if (!(field in userAnswers)) {
        throw new Error(`generic agent has no user answer for ${field}`);
      }
      postBody[field] = userAnswers[field];
    }
    if (cont.user_input_fields) {
      for (const field of cont.user_input_fields) {
        expect(MACHINE_OWNED).not.toContain(field);
        if (field in userAnswers) postBody[field] = userAnswers[field];
      }
    }
    log.push(`human:${required.join("+")}`);
    const result = await runMarketplaceJourney(postBody, deps);
    expect(result.http_status).toBe(200);
    return result.body as AgentView;
  }

  throw new Error(`stuck: status=${body.status}`);
}

function assertNoSecretLeak(body: AgentView, secrets: string[]): void {
  const serialized = JSON.stringify({
    status: body.status,
    message: body.message,
    required_fields: body.required_fields,
    fields: body.fields,
  });
  for (const s of secrets) {
    if (s) expect(serialized).not.toContain(s);
  }
  for (const f of body.required_fields || body.fields || []) {
    expect(MACHINE_OWNED).not.toContain(f);
  }
  expect(JSON.stringify(body)).not.toContain(OBSOLETE_HOST);
  expect(JSON.stringify(body)).not.toMatch(/pass_claim_credential|claim_credential/);
}

describe("generic buyer agent A-to-Z protocol_continuation", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    process.env.NOBU_PASS_CLAIM_SECRET = "test-pass-claim-secret-generic-buyer";
    clearCapturedAgentEmailCodes();
    resetAuthStoreCache();
    resetWebDatabaseCache();
    db = openDatabase(dbPath);
    migrateUp(db);
    await getAuthStore({ sqliteDb: db });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    resetWebDatabaseCache();
    resetAuthStoreCache();
    clearCapturedAgentEmailCodes();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    delete process.env.NOBU_PASS_CLAIM_SECRET;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  it("completes paid pass → free setup → MONITORING_ACTIVE using only contract fields", async () => {
    const deps = {
      sqliteDb: db,
      forceDeterministic: true,
      offersOverride: [targetOffer()],
      sourceKey: "generic-buyer-a2z",
    };
    const settlementRef = "settle_generic_buyer_a2z_001";
    const paymentHeader = "mock-payment-sig-generic-buyer-a2z";

    const paid = await monitoringPassForAgent({
      paymentAuthorizationHeader: paymentHeader,
      resource: "https://www.usenobu.xyz/v1/agent/monitoring-pass",
      sqliteDb: db,
      testVerifier: acceptingVerifier(settlementRef),
      env: {
        NOBU_AUTH_TEST_MODE: "1",
        NOBU_PASS_CLAIM_SECRET: process.env.NOBU_PASS_CLAIM_SECRET,
      },
    });
    expect(paid.ok && paid.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!paid.ok || paid.status !== "MONITORING_PASS_ISSUED") return;

    const paidBody = monitoringPassResponseBody(paid, {
      NOBU_AUTH_TEST_MODE: "1",
    }) as AgentView;

    expect(paidBody.status).toBe("MONITORING_PASS_ISSUED");
    expect(paidBody.current_step).toBe("confirm_use_pass");
    expect(paidBody.payment_status).toBe("recognized");
    expect(paidBody.second_payment_required).toBe(false);
    expect(paidBody.monitoring_active).toBe(false);
    expect(paidBody.journey_complete).toBe(false);
    expect(paidBody.automatic_continue).toBe(false);
    expect(paidBody.input_required).toBe(true);
    expect(paidBody.required_fields).toEqual(["confirm_use_pass"]);
    expect(paidBody.guidance).toBeUndefined();
    expect(paidBody.interaction).toEqual({
      mode: "user_input",
      fields: ["confirm_use_pass"],
      confirmation_required: true,
    });
    expect(paidBody.protocol_continuation).toBeTruthy();
    expect(paidBody.machine_continuation).toEqual(paidBody.protocol_continuation);
    expect(paidBody.protocol_continuation!.endpoint).toBe(
      DEFAULT_FREE_SERVICE_ENDPOINT,
    );
    expect(paidBody.protocol_continuation!.body.journey_id).toBeTruthy();
    expect(paidBody.protocol_continuation!.body.pass_claim_credential).toBeUndefined();
    expect(paidBody.protocol_continuation!.user_input_fields).toEqual([
      "confirm_use_pass",
    ]);
    expect(paidBody.protocol_continuation!.machine_fields).toContain("journey_id");
    expect(paidBody.protocol_continuation!.sensitive_fields).toEqual([]);
    expect((paidBody as Record<string, unknown>).pass_claim_credential).toBeUndefined();
    expect(JSON.stringify(paidBody)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );

    const secretsSeen = [paymentHeader];
    assertNoSecretLeak(paidBody, secretsSeen);

    // Journey already ensured at settlement — one payment, one pass, one journey.
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_passes`).get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_pass_payments`).get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM marketplace_purchase_journeys`).get() as {
        c: number;
      }).c,
    ).toBe(1);

    // Replay paid settlement returns same pass + journey; does not reset stage.
    const replayPaid = await monitoringPassForAgent({
      paymentAuthorizationHeader: paymentHeader,
      resource: "https://www.usenobu.xyz/v1/agent/monitoring-pass",
      sqliteDb: db,
      testVerifier: acceptingVerifier(settlementRef),
      env: {
        NOBU_AUTH_TEST_MODE: "1",
        NOBU_PASS_CLAIM_SECRET: process.env.NOBU_PASS_CLAIM_SECRET,
      },
    });
    expect(replayPaid.ok && replayPaid.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (replayPaid.ok && replayPaid.status === "MONITORING_PASS_ISSUED") {
      expect(replayPaid.pass.id).toBe(paid.pass.id);
      expect(replayPaid.journey_id).toBe(paid.journey_id);
      expect(replayPaid.journey_stage).toBe("confirm_use_pass");
    }

    const log: string[] = [];
    let body = paidBody;
    const journeyId = String(body.journey_id || body.protocol_continuation!.body.journey_id);
    expect(journeyId).toMatch(/^journey_/);

    const purchaseDescription = [
      "I bought an Example Gadget from Target online",
      `on ${recentPurchaseDate()} for $24.99 in TX,`,
      "model WDG-100,",
      "https://www.target.com/p/example-gadget/-/A-87654321",
    ].join(" ");

    const userAnswers: Record<string, unknown> = {
      confirm_use_pass: true,
      purchase_description: purchaseDescription,
      email: "generic-buyer@example.com",
      monitoring_consent: true,
      email_alert_consent: true,
    };

    // confirm_use_pass
    body = await followContinuation(body, deps, userAnswers, log);
    expect(body.required_fields).toEqual(["purchase_description"]);
    expect(body.guidance).toBeUndefined();
    expect(String(body.message || "")).toMatch(/purchase price|purchase date|Target/i);
    expect(body.required_fields).not.toContain("alert_threshold");

    // purchase_description → automatic product_discovery
    body = await followContinuation(body, deps, userAnswers, log);
    expect(body.automatic_continue).toBe(true);
    expect(body.current_step as string | undefined).toBe("product_discovery");
    expect(body.required_fields).toEqual([]);
    expect(body.interaction?.mode).toBe("automatic");

    // product_discovery automatic → candidate_id
    body = await followContinuation(body, deps, userAnswers, log);
    expect(body.required_fields).toEqual(["candidate_id"]);
    expect(body.required_fields).not.toContain("discovery_session_id");
    const candidateId = String(body.message || "").match(/cand_[a-zA-Z0-9_-]+/)?.[0];
    expect(candidateId).toBeTruthy();
    userAnswers.candidate_id = candidateId;

    // candidate_id → email
    body = await followContinuation(body, deps, userAnswers, log);
    expect(body.required_fields).toEqual(["email"]);

    // email → verification_code
    body = await followContinuation(body, deps, userAnswers, log);
    expect(body.required_fields).toEqual(["verification_code"]);
    const store = await getAuthStore({ sqliteDb: db });
    const j = await store.getMarketplacePurchaseJourneyById(journeyId);
    expect(j?.connection_id).toBeTruthy();
    const code = peekCapturedAgentEmailCode(j!.connection_id!);
    expect(code).toMatch(/^\d{6}$/);
    userAnswers.verification_code = code;

    // verification_code → consents (token only in protocol_continuation)
    body = await followContinuation(body, deps, userAnswers, log);
    expect(body.required_fields).toEqual([
      "monitoring_consent",
      "email_alert_consent",
    ]);
    expect(body.required_fields).not.toContain("connection_token");
    const token = String(
      body.protocol_continuation?.body.connection_token || "",
    );
    expect(token).toBeTruthy();
    expect(body.protocol_continuation?.sensitive_fields).toContain("connection_token");
    secretsSeen.push(token);
    assertNoSecretLeak(body, secretsSeen);
    expect((body as Record<string, unknown>).connection_token).toBeUndefined();

    // consents → MONITORING_ACTIVE (or ACTIVATION_PENDING then auto)
    body = await followContinuation(body, deps, userAnswers, log);

    let guard = 0;
    while (
      body.status === "ACTIVATION_PENDING" &&
      body.automatic_continue &&
      guard < 5
    ) {
      expect(body.protocol_continuation?.body.connection_token).toBeTruthy();
      expect(body.required_fields).toEqual([]);
      expect(body.input_required).toBe(false);
      body = await followContinuation(body, deps, userAnswers, log);
      guard += 1;
    }

    expect(body.status).toBe("MONITORING_ACTIVE");
    expect(body.monitoring_active).toBe(true);
    expect(body.journey_complete).toBe(true);
    expect(body.second_payment_required).toBe(false);
    expect(body.payment_status).toBe("recognized");
    expect(JSON.stringify(body)).not.toContain(OBSOLETE_HOST);
    expect(JSON.stringify(body)).not.toMatch(/pass_claim_credential|claim_credential/);

    expect(log.filter((l) => l.startsWith("human:"))).toEqual([
      "human:confirm_use_pass",
      "human:purchase_description",
      "human:candidate_id",
      "human:email",
      "human:verification_code",
      "human:monitoring_consent+email_alert_consent",
    ]);

    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_passes`).get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_pass_payments`).get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM marketplace_purchase_journeys`).get() as {
        c: number;
      }).c,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitor_activations`).get() as { c: number }).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT status FROM monitoring_passes WHERE id = ?`)
          .get(paid.pass.id) as { status: string }
      ).status,
    ).toBe("redeemed");

    // Idempotent complete resume.
    const again = await runMarketplaceJourney({ journey_id: journeyId }, deps);
    expect(again.http_status).toBe(200);
    expect(again.body.status).toBe("MONITORING_ACTIVE");
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitor_activations`).get() as { c: number }).c,
    ).toBe(1);

    // Paid replay after completion returns MONITORING_ACTIVE, no second payment.
    const afterComplete = await monitoringPassForAgent({
      paymentAuthorizationHeader: paymentHeader,
      resource: "https://www.usenobu.xyz/v1/agent/monitoring-pass",
      sqliteDb: db,
      testVerifier: acceptingVerifier(settlementRef),
      env: {
        NOBU_AUTH_TEST_MODE: "1",
        NOBU_PASS_CLAIM_SECRET: process.env.NOBU_PASS_CLAIM_SECRET,
      },
    });
    const afterBody = monitoringPassResponseBody(afterComplete) as AgentView;
    expect(afterBody.status).toBe("MONITORING_ACTIVE");
    expect(afterBody.monitoring_active).toBe(true);
    expect(afterBody.second_payment_required).toBe(false);
    expect(JSON.stringify(afterBody)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );
  });

  it("ensures one journey at settlement; concurrent resume is single journey; historical claim still works", async () => {
    const deps = {
      sqliteDb: db,
      forceDeterministic: true,
      offersOverride: [targetOffer()],
      sourceKey: "generic-buyer-safety",
    };
    const paid = await monitoringPassForAgent({
      paymentAuthorizationHeader: "mock-sig-safety",
      resource: "https://www.usenobu.xyz/v1/agent/monitoring-pass",
      sqliteDb: db,
      testVerifier: acceptingVerifier("settle_generic_safety_001"),
      env: {
        NOBU_AUTH_TEST_MODE: "1",
        NOBU_PASS_CLAIM_SECRET: process.env.NOBU_PASS_CLAIM_SECRET,
      },
    });
    expect(paid.ok && paid.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!paid.ok || paid.status !== "MONITORING_PASS_ISSUED") return;
    const paidBody = monitoringPassResponseBody(paid) as AgentView;
    expect(JSON.stringify(paidBody)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );
    const journeyId = String(paidBody.protocol_continuation!.body.journey_id);

    // Concurrent followers with journey_id → same journey, no second row.
    const [a, b] = await Promise.all([
      runMarketplaceJourney({ journey_id: journeyId }, deps),
      runMarketplaceJourney({ journey_id: journeyId }, deps),
    ]);
    expect(a.http_status).toBe(200);
    expect(b.http_status).toBe(200);
    expect(a.body.journey_id).toBe(journeyId);
    expect(b.body.journey_id).toBe(journeyId);
    expect(a.body.required_fields).toEqual(["confirm_use_pass"]);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM marketplace_purchase_journeys`).get() as {
        c: number;
      }).c,
    ).toBe(1);

    // Historical claim path: synthetic pre-repair continuation with hash, no journey.
    const store = await getAuthStore({ sqliteDb: db });
    const nowIso = new Date().toISOString();
    const histPaymentId = `pass_pay_hist_${Date.now().toString(16)}`;
    const histSettlement = `settle_hist_${Date.now().toString(16)}`;
    const histPayment = await store.upsertMonitoringPassPayment({
      id: histPaymentId,
      authorizationDigest: sha256Hex(`hist-auth-digest-${Date.now()}`),
      status: "settled",
      nowIso,
    });
    await store.updateMonitoringPassPayment({
      id: histPayment.id,
      status: "settled",
      settlementRef: histSettlement,
      nowIso,
    });
    const histPass = await store.issueMonitoringPass({
      id: `pass_hist_${Date.now().toString(16)}`,
      passTokenHash: sha256Hex("hist-pass-token"),
      settlementRef: histSettlement,
      paymentId: histPayment.id,
      priceAmount: 0.99,
      priceCurrency: "USD",
      nowIso,
    });
    // Remove any auto-journey if present (historical: claim creates journey).
    const autoJ = await store.getMarketplacePurchaseJourneyByPassId(
      histPass.pass.id,
    );
    if (autoJ) {
      db.prepare(`DELETE FROM marketplace_purchase_journeys WHERE id = ?`).run(
        autoJ.id,
      );
    }
    const contId = `pass_cont_hist_${Date.now().toString(16)}`;
    const derived = derivePassClaimCredential({
      paymentId: histPayment.id,
      continuationId: contId,
      env: { NOBU_PASS_CLAIM_SECRET: process.env.NOBU_PASS_CLAIM_SECRET },
    })!;
    await store.ensureMonitoringPassContinuation({
      id: contId,
      paymentId: histPayment.id,
      monitoringPassId: histPass.pass.id,
      status: "issued",
      claimCredentialHash: derived.hash,
      nowIso,
    });

    // Public ids alone cannot claim when historical credential is required.
    const publicOnly = await runMarketplaceJourney(
      {
        monitoring_pass_id: histPass.pass.id,
        pass_continuation_id: contId,
      },
      deps,
    );
    expect(publicOnly.http_status).toBe(401);
    expect(publicOnly.body.status).toBe("CLAIM_NOT_AUTHORIZED");

    const claimed = await runMarketplaceJourney(
      {
        pass_continuation_id: contId,
        pass_claim_credential: derived.raw,
      },
      deps,
    );
    expect(claimed.http_status).toBe(200);
    expect(claimed.body.status).toBe("MONITORING_PASS_ISSUED");
    expect(claimed.body.required_fields).toEqual(["confirm_use_pass"]);
    expect(String(claimed.body.journey_id)).toMatch(/^journey_/);

    for (const r of [paidBody, a.body, b.body, claimed.body]) {
      const s = JSON.stringify(r);
      expect(s).not.toContain(OBSOLETE_HOST);
      if ((r as AgentView).protocol_continuation) {
        expect((r as AgentView).protocol_continuation!.endpoint).toContain(
          CANONICAL,
        );
      }
    }
  });
});
