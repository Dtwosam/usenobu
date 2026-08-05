/**
 * Generic buyer-agent A-to-Z proof.
 *
 * The agent knows only:
 *   required_fields | input_required | automatic_continue | protocol_continuation
 *
 * It never asks the user for machine-owned IDs/tokens and never invents a
 * second payment. One mocked settlement → MONITORING_ACTIVE.
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

const CANONICAL = "www.usenobu.xyz";
const OBSOLETE_HOST = "usenobu.vercel.app";

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
  merge_user_fields?: string[];
  sensitive_fields?: string[];
  do_not_ask_user: true;
  do_not_display: true;
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
};

/** Generic buyer agent: only follows the four contract surfaces. */
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
  expect(cont.do_not_ask_user).toBe(true);
  expect(cont.do_not_display).toBe(true);

  // Secrets must not appear in human message.
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
    // Only merge listed fields — never invent machine tokens from userAnswers.
    if (cont.merge_user_fields) {
      for (const field of cont.merge_user_fields) {
        expect(MACHINE_OWNED).not.toContain(field);
        if (field in userAnswers) postBody[field] = userAnswers[field];
      }
    }
    log.push(`human:${required.join("+")}`);
    const result = await runMarketplaceJourney(postBody, deps);
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
    // Intentionally omit protocol_continuation body secrets from "human" surface.
  });
  for (const s of secrets) {
    if (s) expect(serialized).not.toContain(s);
  }
  // required_fields must never list machine-owned names
  for (const f of body.required_fields || body.fields || []) {
    expect(MACHINE_OWNED).not.toContain(f);
  }
  // Full response must not contain obsolete hostname
  expect(JSON.stringify(body)).not.toContain(OBSOLETE_HOST);
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

    // 1. Mock one confirmed paid settlement.
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
    expect(paidBody.payment_status).toBe("recognized");
    expect(paidBody.second_payment_required).toBe(false);
    expect(paidBody.monitoring_active).toBe(false);
    expect(paidBody.journey_complete).toBe(false);
    expect(paidBody.automatic_continue).toBe(true);
    expect(paidBody.input_required).toBe(false);
    expect(paidBody.required_fields).toEqual([]);
    expect(paidBody.protocol_continuation).toBeTruthy();
    expect(paidBody.machine_continuation).toEqual(paidBody.protocol_continuation);
    expect(paidBody.protocol_continuation!.endpoint).toBe(
      DEFAULT_FREE_SERVICE_ENDPOINT,
    );
    expect(paidBody.protocol_continuation!.body.pass_continuation_id).toBeTruthy();
    expect(paidBody.protocol_continuation!.body.pass_claim_credential).toBeTruthy();
    // Credential only inside continuation body — never top-level.
    expect((paidBody as Record<string, unknown>).pass_claim_credential).toBeUndefined();

    const claimSecret = String(
      paidBody.protocol_continuation!.body.pass_claim_credential,
    );
    const secretsSeen = [claimSecret, paymentHeader];

    assertNoSecretLeak(paidBody, secretsSeen);
    // Human-facing serialization of status/message must not include claim secret.
    expect(String(paidBody.message || "")).not.toContain(claimSecret);

    // 2. Post paid continuation → claim + one journey → confirm_use_pass.
    const log: string[] = [];
    let body = await followContinuation(paidBody, deps, {}, log);

    // Replay of paid continuation recovers the same journey (idempotent claim).
    const replay = await followContinuation(paidBody, deps, {}, []);
    expect(replay.journey_id).toBe(body.journey_id);
    expect(replay.status).toBe("MONITORING_PASS_ISSUED");

    const journeyId = String(body.journey_id);
    expect(journeyId).toMatch(/^journey_/);
    expect(body.required_fields).toEqual(["confirm_use_pass"]);
    expect(body.input_required).toBe(true);
    expect(body.automatic_continue).toBe(false);
    assertNoSecretLeak(body, secretsSeen);

    // One pass, one payment, one journey.
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

    const purchaseDescription = [
      "I bought an Example Gadget from Target online",
      `on ${recentPurchaseDate()} for $24.99 in TX,`,
      "model WDG-100,",
      "https://www.target.com/p/example-gadget/-/A-87654321",
    ].join(" ");

    // Dynamic user answers filled as human stages appear.
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
    expect(String(body.message || "")).toMatch(/purchase price|purchase date|Target/i);
    // Must not solicit a custom alert threshold as user input.
    expect(body.required_fields).not.toContain("alert_threshold");
    expect(body.required_fields).not.toContain("price_threshold");

    // purchase_description → automatic product_discovery
    body = await followContinuation(body, deps, userAnswers, log);
    expect(body.automatic_continue).toBe(true);
    expect(body.current_step as string | undefined).toBe("product_discovery");
    expect(body.required_fields).toEqual([]);

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
    secretsSeen.push(token);
    assertNoSecretLeak(body, secretsSeen);
    expect((body as Record<string, unknown>).connection_token).toBeUndefined();

    // consents → MONITORING_ACTIVE (or ACTIVATION_PENDING then auto)
    body = await followContinuation(body, deps, userAnswers, log);

    // Bounded ACTIVATION_PENDING auto-continue if projection pending.
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
    expect(JSON.stringify(body)).not.toContain(claimSecret);
    expect(body.required_fields || []).not.toContain("alert_threshold");

    // Human sequence exact.
    expect(log.filter((l) => l.startsWith("human:"))).toEqual([
      "human:confirm_use_pass",
      "human:purchase_description",
      "human:candidate_id",
      "human:email",
      "human:verification_code",
      "human:monitoring_consent+email_alert_consent",
    ]);

    // Exactly-once durable outcomes.
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
    expect(again.body.status).toBe("MONITORING_ACTIVE");
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitor_activations`).get() as { c: number }).c,
    ).toBe(1);
  });

  it("public ids alone cannot claim; ACTIVATION_PENDING carries token; concurrent claim is single journey", async () => {
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
    const cont = paidBody.protocol_continuation!;
    const passId = String(paidBody.monitoring_pass_id);
    const contId = String(cont.body.pass_continuation_id);
    const claim = String(cont.body.pass_claim_credential);

    // Public IDs alone cannot claim.
    const publicOnly = await runMarketplaceJourney(
      { monitoring_pass_id: passId, pass_continuation_id: contId },
      deps,
    );
    expect(publicOnly.http_status).toBe(401);
    expect(publicOnly.body.status).toBe("CLAIM_NOT_AUTHORIZED");
    expect(publicOnly.body.second_payment_required).toBe(false);

    // Concurrent followers → one journey.
    const [a, b] = await Promise.all([
      runMarketplaceJourney(
        {
          pass_continuation_id: contId,
          pass_claim_credential: claim,
        },
        deps,
      ),
      runMarketplaceJourney(
        {
          pass_continuation_id: contId,
          pass_claim_credential: claim,
        },
        deps,
      ),
    ]);
    const journeyIds = new Set(
      [a, b]
        .filter((r) => r.body.journey_id)
        .map((r) => String(r.body.journey_id)),
    );
    expect(journeyIds.size).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM marketplace_purchase_journeys`).get() as {
        c: number;
      }).c,
    ).toBe(1);

    // Every endpoint in responses uses canonical domain.
    for (const r of [paidBody, a.body, b.body]) {
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
