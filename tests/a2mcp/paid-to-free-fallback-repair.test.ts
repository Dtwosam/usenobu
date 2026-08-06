/**
 * Paid-to-free fallback repair: machine-owned fields never in user-input
 * contracts; connection_token preserved on every consent retry.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recentPurchaseDate } from "../helpers/test-dates.js";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import { getAuthStore, resetAuthStoreCache } from "../../src/auth/auth-store.js";
import {
  clearCapturedAgentEmailCodes,
  peekCapturedAgentEmailCode,
} from "../../src/auth/email.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import { runMarketplaceJourney } from "../../src/a2mcp/marketplace-journey.js";
import { resolveMonitoringPassForAgent } from "../../src/payments/monitoring-pass-service.js";
import { buildConversationContract } from "../../src/a2mcp/conversation-contract.js";
import { derivePassClaimCredential } from "../../src/payments/claim-credential.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import * as agentPreflight from "../../src/web/agent-preflight-service.js";
import * as redeemPass from "../../src/payments/redeem-monitoring-pass.js";

const MACHINE_OWNED = [
  "pass_continuation_id",
  "pass_claim_credential",
  "monitoring_pass_id",
  "journey_id",
  "discovery_session_id",
  "connection_id",
  "connection_token",
  "quote_id",
  "claim_credential",
];

const CANONICAL_FREE = "https://www.usenobu.xyz/v1/agent";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-fallback-repair-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function targetOffer(): MatchableOffer {
  return {
    offer_id: "fallback-offer",
    title: "Example Gadget WDG-100",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-gadget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: 19.99,
    currency: "USD",
    serpapi_product_id: "fallback-product",
  };
}

function assertNoMachineOwnedUserInput(body: Record<string, unknown>): void {
  for (const key of ["required_fields", "fields", "requiredArgs"] as const) {
    const list = body[key];
    if (Array.isArray(list)) {
      for (const f of list) {
        expect(MACHINE_OWNED).not.toContain(f);
      }
    }
  }
  const rui = body.required_user_input as
    | { required_fields?: string[] }
    | null
    | undefined;
  if (rui?.required_fields) {
    for (const f of rui.required_fields) {
      expect(MACHINE_OWNED).not.toContain(f);
    }
  }
}

function assertNoCredentialAskInText(body: Record<string, unknown>): void {
  const text = `${body.message || ""} ${body.guidance || ""}`;
  // Must not instruct providing machine credentials / IDs
  expect(text).not.toMatch(
    /Provide (a valid )?(pass_continuation_id|monitoring_pass_id|pass_claim_credential|connection_token)/i,
  );
  expect(text).not.toMatch(
    /Use pass_continuation_id and pass_claim_credential/i,
  );
  expect(text).not.toMatch(
    /retry with pass_continuation_id/i,
  );
  expect(text).not.toMatch(
    /Ask (the user )?for (the )?connection_token/i,
  );
}

function seedIssuedPass(
  db: ReturnType<typeof openDatabase>,
  seed: string,
): { passId: string; continuationId: string; claimCredential: string } {
  const nowIso = new Date().toISOString();
  const paymentId = `pay_${seed}`;
  const passId = `pass_${seed}_1234567890abcdef`;
  const continuationId = `pass_cont_${seed}_1234567890abcdef`;
  const derived = derivePassClaimCredential({
    paymentId,
    continuationId,
    env: { NOBU_AUTH_TEST_MODE: "1" },
  })!;
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
     (id, payment_id, monitoring_pass_id, status, claim_credential_hash, created_at, updated_at)
     VALUES (?,?,?,'issued',?,?,?)`,
  ).run(continuationId, paymentId, passId, derived.hash, nowIso, nowIso);
  return { passId, continuationId, claimCredential: derived.raw };
}

async function advanceToConsents(args: {
  db: ReturnType<typeof openDatabase>;
  seed: string;
  email: string;
}): Promise<{
  journeyId: string;
  connectionToken: string;
  passId: string;
  deps: {
    sqliteDb: ReturnType<typeof openDatabase>;
    forceDeterministic: boolean;
    offersOverride: MatchableOffer[];
    sourceKey: string;
  };
}> {
  const { passId, continuationId, claimCredential } = seedIssuedPass(
    args.db,
    args.seed,
  );
  const deps = {
    sqliteDb: args.db,
    forceDeterministic: true,
    offersOverride: [targetOffer()],
    sourceKey: `fallback-${args.seed}`,
  };
  const resolved = await runMarketplaceJourney(
    {
      monitoring_pass_id: passId,
      pass_continuation_id: continuationId,
      pass_claim_credential: claimCredential,
    },
    deps,
  );
  const journeyId = String(resolved.body.journey_id);
  await runMarketplaceJourney(
    { journey_id: journeyId, confirm_use_pass: true },
    deps,
  );
  const purchaseDescription = [
    "I bought an Example Gadget from Target online",
    `on ${recentPurchaseDate()} for $24.99 in TX,`,
    "model WDG-100,",
    "https://www.target.com/p/example-gadget/-/A-87654321",
  ].join(" ");
  await runMarketplaceJourney(
    { journey_id: journeyId, purchase_description: purchaseDescription },
    deps,
  );
  const discovered = await runMarketplaceJourney({ journey_id: journeyId }, deps);
  const candidateId = String(discovered.body.message).match(
    /cand_[a-zA-Z0-9_-]+/,
  )?.[0];
  expect(candidateId).toBeTruthy();
  await runMarketplaceJourney(
    { journey_id: journeyId, candidate_id: candidateId },
    deps,
  );
  await runMarketplaceJourney(
    { journey_id: journeyId, email: args.email },
    deps,
  );
  const store = await getAuthStore({ sqliteDb: args.db });
  const j = await store.getMarketplacePurchaseJourneyById(journeyId);
  const code = peekCapturedAgentEmailCode(j!.connection_id!);
  const verified = await runMarketplaceJourney(
    { journey_id: journeyId, verification_code: code },
    deps,
  );
  expect(verified.body.current_step).toBe("consents");
  const connectionToken = String(
    (
      verified.body.protocol_continuation as {
        body: Record<string, unknown>;
      }
    ).body.connection_token || "",
  );
  expect(connectionToken).toBeTruthy();
  return { journeyId, connectionToken, passId, deps };
}

describe("buildConversationContract cannot bypass machine-owned filter", () => {
  it("strips machine-owned names from explicit required_user_input and fields", () => {
    const c = buildConversationContract({
      status: "test",
      completed_step: "X",
      next_action: "Y",
      message: "m",
      guidance: "g",
      payment_status: "not_required",
      required_fields: ["connection_token", "email", "journey_id"],
      required_user_input: {
        required_fields: [
          "pass_claim_credential",
          "monitoring_consent",
          "connection_token",
        ],
        description: "x",
      },
      extra_fields: ["quote_id", "discovery_session_id"],
    });
    expect(c.required_fields).toEqual(["email"]);
    expect(c.fields).toEqual(["email"]);
    expect(c.requiredArgs).toEqual(["email"]);
    expect(
      (c.required_user_input as { required_fields: string[] }).required_fields,
    ).toEqual(["monitoring_consent"]);
  });
});

describe("pass-resolution fallbacks never leak machine-owned user input", () => {
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
    try {
      db.close();
    } catch {
      /* ignore */
    }
    resetAuthStoreCache();
    resetWebDatabaseCache();
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

  it("not-found / unknown continuation returns INTERNAL with empty user lists", async () => {
    const r = await runMarketplaceJourney(
      {
        pass_continuation_id: "pass_cont_does_not_exist_xyz",
        pass_claim_credential: "pass_claim_fake",
      },
      { sqliteDb: db },
    );
    expect(r.body.status).toBe("INTERNAL_CONTINUATION_STATE_MISSING");
    expect(r.body.input_required).toBe(false);
    expect(r.body.required_fields).toEqual([]);
    expect(r.body.fields).toEqual([]);
    expect(r.body.requiredArgs).toEqual([]);
    expect(r.body.required_user_input).toBeNull();
    expect(r.body.second_payment_required).toBe(false);
    expect(r.body.monitoring_active).toBe(false);
    expect(r.body.retry_safe).toBe(false);
    expect(r.body.next_action).toBe("CONTACT_SUPPORT_WITH_JOURNEY_ID");
    assertNoMachineOwnedUserInput(r.body);
    assertNoCredentialAskInText(r.body);
  });

  it("unauthorized public-id claim is 401 without credential instructions", async () => {
    const { passId, continuationId } = seedIssuedPass(db, "unauth");
    const r = await runMarketplaceJourney(
      {
        monitoring_pass_id: passId,
        pass_continuation_id: continuationId,
      },
      { sqliteDb: db },
    );
    expect(r.http_status).toBe(401);
    expect(r.body.status).toBe("CLAIM_NOT_AUTHORIZED");
    expect(r.body.second_payment_required).toBe(false);
    expect(r.body.required_fields).toEqual([]);
    expect(r.body.fields).toEqual([]);
    expect(r.body.requiredArgs).toEqual([]);
    expect(r.body.required_user_input).toBeNull();
    assertNoMachineOwnedUserInput(r.body);
    assertNoCredentialAskInText(r.body);
    expect(String(r.body.message || "")).not.toMatch(/pass_claim_credential is required/i);
  });

  it("mismatched and missing resolve bodies have no machine-owned required fields", async () => {
    const missing = await resolveMonitoringPassForAgent({
      sqliteDb: db,
    });
    expect(missing.body.status).toBe("INTERNAL_CONTINUATION_STATE_MISSING");
    assertNoMachineOwnedUserInput(missing.body as Record<string, unknown>);
    assertNoCredentialAskInText(missing.body as Record<string, unknown>);

    const { passId, continuationId } = seedIssuedPass(db, "mismatch");
    const mismatch = await resolveMonitoringPassForAgent({
      monitoringPassId: passId,
      passContinuationId: `${continuationId}_wrong`,
      sqliteDb: db,
    });
    // Wrong continuation id → not found / internal missing path
    assertNoMachineOwnedUserInput(mismatch.body as Record<string, unknown>);
    assertNoCredentialAskInText(mismatch.body as Record<string, unknown>);
    expect(
      JSON.stringify({
        required_fields: mismatch.body.required_fields,
        fields: mismatch.body.fields,
        requiredArgs: mismatch.body.requiredArgs,
        required_user_input: mismatch.body.required_user_input,
      }),
    ).not.toMatch(
      /pass_continuation_id|pass_claim_credential|connection_token|discovery_session_id/,
    );

    const historical = await resolveMonitoringPassForAgent({
      monitoringPassId: "pass_historical_only_public_id",
      sqliteDb: db,
    });
    expect(historical.body.status).toBe("INTERNAL_CONTINUATION_STATE_MISSING");
    assertNoMachineOwnedUserInput(historical.body as Record<string, unknown>);
    assertNoCredentialAskInText(historical.body as Record<string, unknown>);
  });
});

describe("consent token preservation and retry", () => {
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
    vi.restoreAllMocks();
    try {
      db.close();
    } catch {
      /* ignore */
    }
    resetAuthStoreCache();
    resetWebDatabaseCache();
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

  it("consent-stage without token returns INTERNAL_CONTINUATION_STATE_MISSING", async () => {
    const { journeyId, deps } = await advanceToConsents({
      db,
      seed: "notoken",
      email: "notoken@example.com",
    });
    const r = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      deps,
    );
    expect(r.body.status).toBe("INTERNAL_CONTINUATION_STATE_MISSING");
    expect(r.body.input_required).toBe(false);
    expect(r.body.required_fields).toEqual([]);
    expect(r.body.protocol_continuation).toBeNull();
    assertNoMachineOwnedUserInput(r.body);
    assertNoCredentialAskInText(r.body);
  });

  it("incomplete consents with token preserve the same token", async () => {
    const { journeyId, connectionToken, deps } = await advanceToConsents({
      db,
      seed: "incomp",
      email: "incomp@example.com",
    });
    const r = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        connection_token: connectionToken,
        // missing consents
      },
      deps,
    );
    expect(r.body.current_step).toBe("consents");
    expect(r.body.required_fields).toEqual([
      "monitoring_consent",
      "email_alert_consent",
    ]);
    const cont = r.body.protocol_continuation as {
      endpoint: string;
      body: Record<string, unknown>;
      user_input_fields?: string[];
      sensitive_fields?: string[];
    };
    expect(cont.endpoint).toBe(CANONICAL_FREE);
    expect(cont.body.connection_token).toBe(connectionToken);
    expect(cont.body.journey_id).toBe(journeyId);
    expect(cont.user_input_fields).toEqual([
      "monitoring_consent",
      "email_alert_consent",
    ]);
    expect(cont.sensitive_fields).toContain("connection_token");
    expect(r.body.connection_token).toBeUndefined();
  });

  it("preflight fails once, preserves token, retry succeeds", async () => {
    const { journeyId, connectionToken, passId, deps } =
      await advanceToConsents({
        db,
        seed: "prefail",
        email: "prefail@example.com",
      });

    const spy = vi
      .spyOn(agentPreflight, "preflightMonitoringForAgent")
      .mockResolvedValueOnce({
        ok: false,
        status: "CONSENT_REQUIRED",
        http_status: 400,
      } as never);

    const failed = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        connection_token: connectionToken,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      deps,
    );
    expect(failed.body.current_step).toBe("consents");
    expect(failed.body.required_fields).toEqual([
      "monitoring_consent",
      "email_alert_consent",
    ]);
    const tokenAfter = String(
      (
        failed.body.protocol_continuation as {
          body: Record<string, unknown>;
        }
      ).body.connection_token || "",
    );
    expect(tokenAfter).toBe(connectionToken);
    expect(
      (
        failed.body.protocol_continuation as { endpoint: string }
      ).endpoint,
    ).toBe(CANONICAL_FREE);
    spy.mockRestore();

    const active = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        connection_token: connectionToken,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      deps,
    );
    expect(active.body.status).toBe("MONITORING_ACTIVE");
    expect(active.body.second_payment_required).toBe(false);
    expect(
      (
        db
          .prepare(`SELECT status FROM monitoring_passes WHERE id = ?`)
          .get(passId) as { status: string }
      ).status,
    ).toBe("redeemed");
  });

  it("redemption fails retryably once, preserves token, retry succeeds without second pass", async () => {
    const { journeyId, connectionToken, passId, deps } =
      await advanceToConsents({
        db,
        seed: "redfail",
        email: "redfail@example.com",
      });

    const spy = vi
      .spyOn(redeemPass, "redeemMonitoringPassForAgent")
      .mockResolvedValueOnce({
        ok: false,
        status: "PASS_NOT_REDEEMABLE",
        http_status: 400,
      } as never);

    const failed = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        connection_token: connectionToken,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      deps,
    );
    expect(failed.body.current_step).toBe("consents");
    const tokenAfter = String(
      (
        failed.body.protocol_continuation as {
          body: Record<string, unknown>;
        }
      ).body.connection_token || "",
    );
    expect(tokenAfter).toBe(connectionToken);
    expect(
      (
        db
          .prepare(`SELECT status FROM monitoring_passes WHERE id = ?`)
          .get(passId) as { status: string }
      ).status,
    ).toBe("issued");
    spy.mockRestore();

    const active = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        connection_token: connectionToken,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      deps,
    );
    expect(active.body.status).toBe("MONITORING_ACTIVE");
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS c FROM monitor_activations`).get() as {
          c: number;
        }
      ).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT status FROM monitoring_passes WHERE id = ?`)
          .get(passId) as { status: string }
      ).status,
    ).toBe("redeemed");
  });

  it("verification-code replay after advance creates no duplicate connection and never returns tokenless consents", async () => {
    const { journeyId, connectionToken, deps } = await advanceToConsents({
      db,
      seed: "vreplay",
      email: "vreplay@example.com",
    });
    const connCount = (
      db.prepare(`SELECT COUNT(*) AS c FROM agent_connections`).get() as {
        c: number;
      }
    ).c;
    expect(connCount).toBe(1);

    // Replaying a used code without token once stage is consents.
    const noToken = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        verification_code: "000000",
      },
      deps,
    );
    expect(noToken.body.status).toBe("INTERNAL_CONTINUATION_STATE_MISSING");
    expect(noToken.body.protocol_continuation).toBeNull();
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS c FROM agent_connections`).get() as {
          c: number;
        }
      ).c,
    ).toBe(1);

    // Same journey with preserved token still yields consent stage.
    const withToken = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        connection_token: connectionToken,
      },
      deps,
    );
    expect(withToken.body.current_step).toBe("consents");
    expect(
      (
        withToken.body.protocol_continuation as {
          body: Record<string, unknown>;
        }
      ).body.connection_token,
    ).toBe(connectionToken);
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS c FROM agent_connections`).get() as {
          c: number;
        }
      ).c,
    ).toBe(1);
  });
});
