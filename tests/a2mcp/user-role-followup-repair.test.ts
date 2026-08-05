/**
 * Focused proof for User-role journey follow-up repair:
 * bare service_id selection, no-result discovery stop, activation_pending resume.
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
import { POST as freePost } from "../../app/v1/agent/route.js";
import { runMarketplaceJourney } from "../../src/a2mcp/marketplace-journey.js";
import { marketplaceIncompleteContract } from "../../src/a2mcp/conversation-contract.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import * as startMonitoring from "../../src/payments/start-monitoring-service.js";

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function postAgent(body: unknown): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await freePost(
    new Request("http://localhost/v1/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await json(res) };
}

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-followup-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function targetOffer(): MatchableOffer {
  return {
    offer_id: "followup-proof-offer",
    title: "Example Gadget WDG-100",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-gadget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: 19.99,
    currency: "USD",
    serpapi_product_id: "followup-proof-product",
  };
}

describe("bare service_id selection (findings 1)", () => {
  it.each([
    [33561, "not_required", "Nobu Purchase Setup"],
    ["33561", "not_required", "Nobu Purchase Setup"],
    [35958, "required", "Nobu Monitoring Pass"],
    ["35958", "required", "Nobu Monitoring Pass"],
  ])(
    "1/2 bare service_id %s selects without SERVICE_SELECTION_REQUIRED",
    async (serviceId, payment, name) => {
      const { status, body } = await postAgent({ service_id: serviceId });
      expect(status).toBe(200);
      expect(body.status).toBe("SERVICE_SELECTED");
      expect(body.status).not.toBe("SERVICE_SELECTION_REQUIRED");
      expect(body.selected_service_id).toBe(Number(serviceId));
      expect(body.selected_service_name).toBe(name);
      expect(body.payment_status).toBe(payment);
    },
  );

  it("3 bare service_id never loops to SERVICE_SELECTION_REQUIRED", async () => {
    const first = await postAgent({ service_id: 33561 });
    expect(first.body.status).toBe("SERVICE_SELECTED");
    const second = await postAgent({ service_id: 35958 });
    expect(second.body.status).toBe("SERVICE_SELECTED");
    expect(second.body.selected_service_id).toBe(35958);
  });

  it("4 action-based SELECT_SERVICE remains compatible", async () => {
    const free = await postAgent({
      action: "SELECT_SERVICE",
      service_id: 33561,
    });
    expect(free.body.status).toBe("SERVICE_SELECTED");
    expect(free.body.selected_service_id).toBe(33561);
    const paid = await postAgent({
      action: "SELECT_SERVICE",
      service_id: 35958,
    });
    expect(paid.body.status).toBe("SERVICE_SELECTED");
    expect(paid.body.selected_service_id).toBe(35958);
  });

  it("unknown service_id fails safely", async () => {
    const { status, body } = await postAgent({ service_id: 99999 });
    expect(status).toBe(400);
    expect(body.status).toBe("SERVICE_SELECTION_REQUIRED");
    expect(body.error).toBe("unknown_service_id");
  });
});

describe("human stages have null machine_continuation (finding cleanup)", () => {
  it("7 human stages set machine_continuation null", () => {
    for (const stage of [
      "confirm_use_pass",
      "purchase_description",
      "candidate_id",
      "email",
      "verification_code",
      "consents",
    ] as const) {
      const body = marketplaceIncompleteContract({
        stage,
        journeyId: "journey_human_null",
      });
      expect(body.automatic_continue).toBe(false);
      expect(body.machine_continuation).toBeNull();
      expect(body.journey_id).toBe("journey_human_null");
      expect(body.fields).not.toContain("journey_id");
    }
  });
});

describe("no-result discovery and activation_pending", () => {
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
    // Durable auth tables (monitoring_passes, journeys, etc.).
    await getAuthStore({ sqliteDb: db });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
    resetAuthStoreCache();
    resetWebDatabaseCache();
  });

  function seedIssuedPass(seed: string) {
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

  it("5/6 no-candidate discovery stops and requests clearer description", async () => {
    const { passId } = seedIssuedPass("nodisc");
    const deps = {
      sqliteDb: db,
      forceDeterministic: true,
      offersOverride: [] as MatchableOffer[],
      sourceKey: "no-disc",
    };
    const resolved = await runMarketplaceJourney({ monitoring_pass_id: passId }, deps);
    const journeyId = String(resolved.body.journey_id);
    await runMarketplaceJourney(
      { journey_id: journeyId, confirm_use_pass: true },
      deps,
    );
    const purchaseDescription = [
      "I bought something from Target online",
      `on ${recentPurchaseDate()} for $24.99 in TX`,
    ].join(" ");
    const extracted = await runMarketplaceJourney(
      { journey_id: journeyId, purchase_description: purchaseDescription },
      deps,
    );
    // First hop into discovery is still automatic.
    expect(extracted.body.automatic_continue).toBe(true);
    expect(extracted.body.current_step).toBe("product_discovery");

    const discovered = await runMarketplaceJourney({ journey_id: journeyId }, deps);
    expect(discovered.http_status).toBe(400);
    expect(discovered.body.status).toBe("MORE_INFORMATION_REQUIRED");
    expect(discovered.body.current_step).toBe("purchase_description");
    expect(discovered.body.input_required).toBe(true);
    expect(discovered.body.automatic_continue).toBe(false);
    expect(discovered.body.machine_continuation).toBeNull();
    expect(discovered.body.fields).toEqual(["purchase_description"]);
    expect(discovered.body.required_fields).toEqual(["purchase_description"]);
    expect(String(discovered.body.message)).toMatch(/Target URL|TCIN|model/i);

    // Durable stage is purchase_description — not another auto discovery.
    const store = await getAuthStore({ sqliteDb: db });
    const row = await store.getMarketplacePurchaseJourneyById(journeyId);
    expect(row?.stage).toBe("purchase_description");
  });

  it("8-11 activation_pending is durable, resumable, and does not re-charge", async () => {
    const { passId } = seedIssuedPass("actpend");
    const deps = {
      sqliteDb: db,
      forceDeterministic: true,
      offersOverride: [targetOffer()],
      sourceKey: "act-pend",
    };

    // Cross-module spy: redeem calls resolveActivationResponse from this module.
    // First redemption returns pending without finishing projection.
    const resolveSpy = vi
      .spyOn(startMonitoring, "resolveActivationResponse")
      .mockImplementationOnce(async (args) => ({
        ok: true as const,
        status: "ACTIVATION_PENDING" as const,
        http_status: 200 as const,
        monitor_id: args.activation.monitor_id,
      }));

    const resolved = await runMarketplaceJourney({ monitoring_pass_id: passId }, deps);
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
    // automatic discovery continue
    const discovered = await runMarketplaceJourney({ journey_id: journeyId }, deps);
    const candidateId = String(discovered.body.message).match(/cand_[a-zA-Z0-9_-]+/)?.[0];
    expect(candidateId).toBeTruthy();
    await runMarketplaceJourney(
      { journey_id: journeyId, candidate_id: candidateId },
      deps,
    );
    await runMarketplaceJourney(
      { journey_id: journeyId, email: "actpend@example.com" },
      deps,
    );
    const store = await getAuthStore({ sqliteDb: db });
    const j1 = await store.getMarketplacePurchaseJourneyById(journeyId);
    const code = peekCapturedAgentEmailCode(j1!.connection_id!);
    await runMarketplaceJourney(
      { journey_id: journeyId, verification_code: code },
      deps,
    );

    const pending = await runMarketplaceJourney(
      {
        journey_id: journeyId,
        monitoring_consent: true,
        email_alert_consent: true,
      },
      deps,
    );
    expect(pending.http_status).toBe(200);
    expect(pending.body.status).toBe("ACTIVATION_PENDING");
    expect(pending.body.input_required).toBe(false);
    expect(pending.body.automatic_continue).toBe(true);
    expect(pending.body.fields).toEqual([]);
    expect(pending.body.required_fields).toEqual([]);
    expect(pending.body.machine_continuation).toEqual(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ journey_id: journeyId }),
        do_not_ask_user: true,
      }),
    );
    expect(String(pending.body.guidance || "")).not.toMatch(
      /confirm both consents|Provide consents/i,
    );
    expect(pending.body.second_payment_required).toBe(false);

    const afterPending = await store.getMarketplacePurchaseJourneyById(journeyId);
    expect(afterPending?.stage).toBe("activation_pending");
    expect(afterPending?.quote_id).toBeTruthy();
    const quoteId = afterPending!.quote_id!;
    const passStatus = (
      db.prepare(`SELECT status FROM monitoring_passes WHERE id = ?`).get(passId) as {
        status: string;
      }
    ).status;
    expect(passStatus).toBe("redeemed");
    const activationCount = (
      db.prepare(`SELECT COUNT(*) AS c FROM monitor_activations`).get() as { c: number }
    ).c;
    expect(activationCount).toBe(1);

    // Further resumes use the real activation resolution path.
    resolveSpy.mockRestore();

    // Ensure activation is still pending_projection if the mock skipped projection.
    db.prepare(
      `UPDATE monitor_activations SET status = 'pending_projection', projected_at = NULL
       WHERE quote_id = ?`,
    ).run(quoteId);

    // Retry with journey_id only — no consents, no new payment.
    const resumed = await runMarketplaceJourney({ journey_id: journeyId }, deps);
    expect(resumed.http_status).toBe(200);
    expect(resumed.body.status).toBe("MONITORING_ACTIVE");
    expect(resumed.body.monitoring_active).toBe(true);
    expect(resumed.body.journey_complete).toBe(true);
    expect(resumed.body.second_payment_required).toBe(false);
    expect(JSON.stringify(resumed.body)).not.toMatch(
      /monitoring_consent|email_alert_consent/,
    );

    const final = await store.getMarketplacePurchaseJourneyById(journeyId);
    expect(final?.stage).toBe("complete");
    expect(final?.quote_id).toBe(quoteId);

    // Still exactly one activation and one redeemed pass — no re-mint.
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitor_activations`).get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_enrollment_quotes`).get() as {
        c: number;
      }).c,
    ).toBe(1);
    expect(
      (
        db.prepare(`SELECT status FROM monitoring_passes WHERE id = ?`).get(passId) as {
          status: string;
        }
      ).status,
    ).toBe("redeemed");

    // Second resume is still MONITORING_ACTIVE, no new quote.
    const again = await runMarketplaceJourney({ journey_id: journeyId }, deps);
    expect(again.body.status).toBe("MONITORING_ACTIVE");
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM monitoring_enrollment_quotes`).get() as {
        c: number;
      }).c,
    ).toBe(1);
  });
});
