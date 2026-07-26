import { randomUUID } from "node:crypto";
import type { NobuDatabase } from "../db/index.js";
import { getAuthStore } from "../auth/auth-store.js";
import { sha256Hex } from "../auth/crypto.js";
import {
  beginAgentEmailVerification,
  verifyAgentEmailCode,
} from "../auth/agent-connections.js";
import { understandPurchase, type UnderstandDeps } from "../ai/understand-purchase.js";
import {
  confirmProductForAgent,
  discoverProductForAgent,
  preflightMonitoringForAgent,
} from "../web/agent-preflight-service.js";
import { redeemMonitoringPassForAgent } from "../payments/redeem-monitoring-pass.js";
import { resolveMonitoringPassForAgent } from "../payments/monitoring-pass-service.js";
import type { MatchableOffer } from "../matching/types.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type MarketplaceJourneyDeps = Omit<UnderstandDeps, "now"> & {
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  sourceKey?: string;
  now?: Date;
  offersOverride?: MatchableOffer[];
};

type JourneyStage =
  | "confirm_use_pass"
  | "purchase_description"
  | "candidate_id"
  | "email"
  | "verification_code"
  | "consents"
  | "complete";

const stageField: Record<Exclude<JourneyStage, "complete">, string[]> = {
  confirm_use_pass: ["confirm_use_pass"],
  purchase_description: ["purchase_description"],
  candidate_id: ["candidate_id"],
  email: ["email"],
  verification_code: ["verification_code"],
  consents: ["monitoring_consent", "email_alert_consent"],
};

const stageMessage: Record<Exclude<JourneyStage, "complete">, string> = {
  confirm_use_pass:
    "Your Monitoring Pass is ready. No additional payment is required. Would you like to use it now?",
  purchase_description:
    "Describe the recent Target online purchase. Provide purchase details only; do not include email or consent.",
  candidate_id:
    "Choose the exact Target product candidate. Nobu will not choose or confirm it for you.",
  email:
    "The exact product is confirmed. Provide the email address you control for alerts.",
  verification_code:
    "Enter the six-digit verification code sent to that email address.",
  consents:
    "Email is verified. Confirm monitoring consent and email-alert consent explicitly.",
};

function incomplete(
  stage: Exclude<JourneyStage, "complete">,
  journeyId: string,
  message = stageMessage[stage],
) {
  const fields = [...stageField[stage], "journey_id"];
  return {
    http_status: 400 as const,
    body: {
      status: "input_required",
      journey_id: journeyId,
      fields,
      requiredArgs: fields,
      message,
    },
  };
}

function newJourneyId(): string {
  return `journey_${randomUUID().replace(/-/g, "")}`;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasForbiddenEarlyInput(raw: Record<string, unknown>, stage: JourneyStage): boolean {
  const order: JourneyStage[] = [
    "confirm_use_pass",
    "purchase_description",
    "candidate_id",
    "email",
    "verification_code",
    "consents",
    "complete",
  ];
  const at = order.indexOf(stage);
  if (at < order.indexOf("email") && "email" in raw) return true;
  if (
    at < order.indexOf("consents") &&
    ("monitoring_consent" in raw || "email_alert_consent" in raw)
  ) return true;
  return false;
}

export function isMarketplaceJourneyRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const body = raw as Record<string, unknown>;
  return (
    typeof body.action !== "string" &&
    [
      "journey_id",
      "monitoring_pass_id",
      "pass_continuation_id",
      "confirm_use_pass",
      "purchase_description",
      "purchase_text",
      "candidate_id",
      "email",
      "verification_code",
      "code",
      "monitoring_consent",
      "email_alert_consent",
    ].some((key) => key in body)
  );
}

export function marketplaceFirstContact() {
  return {
    http_status: 400 as const,
    body: {
      status: "input_required",
      journey_id: "",
      fields: ["monitoring_pass_id"],
      requiredArgs: ["monitoring_pass_id"],
      message:
        "Already have a Nobu Monitoring Pass? Provide its monitoring_pass_id to start free Purchase Setup. If you do not own a pass, use the separate Monitoring Pass service once.",
    },
  };
}

export async function runMarketplaceJourney(
  rawValue: unknown,
  deps: MarketplaceJourneyDeps = {},
): Promise<{ http_status: number; body: Record<string, unknown> }> {
  const raw = (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
    ? rawValue
    : {}) as Record<string, unknown>;
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const store = await getAuthStore({ sqliteDb: deps.sqliteDb, env: deps.env });

  let journey = cleanString(raw.journey_id)
    ? await store.getMarketplacePurchaseJourneyById(cleanString(raw.journey_id))
    : null;

  if (!journey) {
    const passId = cleanString(raw.monitoring_pass_id);
    const continuationId = cleanString(raw.pass_continuation_id);
    if (!passId && !continuationId) return marketplaceFirstContact();
    const resolution = await resolveMonitoringPassForAgent({
      monitoringPassId: passId || undefined,
      passContinuationId: continuationId || undefined,
      now,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
    });
    if (
      resolution.http_status !== 200 ||
      resolution.body.status !== "MONITORING_PASS_ISSUED" ||
      typeof resolution.body.monitoring_pass_id !== "string"
    ) {
      const referenceField = passId
        ? "monitoring_pass_id"
        : "pass_continuation_id";
      return {
        http_status: 400,
        body: {
          status: "input_required",
          journey_id: "",
          fields: [referenceField],
          requiredArgs: [referenceField],
          message:
            resolution.body.status === "PAYMENT_SETTLEMENT_PENDING"
              ? "Settlement is still confirming. Do not pay again; retry this same pass reference later."
              : "That Monitoring Pass could not be resolved. Check the pass reference and try again.",
        },
      };
    }
    journey = await store.ensureMarketplacePurchaseJourney({
      id: newJourneyId(),
      monitoringPassId: resolution.body.monitoring_pass_id,
      passContinuationId:
        typeof resolution.body.pass_continuation_id === "string"
          ? resolution.body.pass_continuation_id
          : null,
      nowIso,
    });
  }

  const stage = journey.stage as JourneyStage;
  if (stage === "complete") {
    return {
      http_status: 200,
      body: {
        status: "MONITORING_ACTIVE",
        journey_id: journey.id,
        fields: [],
        requiredArgs: [],
        message: "Monitoring is active. A lower price, alert, or adjustment is never guaranteed.",
      },
    };
  }
  if (hasForbiddenEarlyInput(raw, stage)) return incomplete(stage, journey.id);

  if (stage === "confirm_use_pass") {
    if (raw.confirm_use_pass !== true) return incomplete(stage, journey.id);
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "purchase_description",
      nowIso,
    });
    return incomplete("purchase_description", journey.id);
  }

  if (stage === "purchase_description") {
    const description = cleanString(raw.purchase_description || raw.purchase_text);
    if (!description) return incomplete(stage, journey.id);
    const understood = await understandPurchase(description, {
      llm: deps.llm,
      forceDeterministic: deps.forceDeterministic,
      forceUnavailable: deps.forceUnavailable,
      now: () => now,
    });
    if (!understood.ok || understood.body.missing_fields.length > 0) {
      return incomplete(stage, journey.id);
    }
    const p = understood.body.extracted_purchase;
    const discovered = await discoverProductForAgent(
      {
        purchase_price: p.purchase_price!,
        purchase_date: p.purchase_date!,
        purchase_channel: "target_online",
        country: "US",
        ...(p.region ? { region: p.region } : {}),
        ...(p.product_description ? { product_title: p.product_description } : {}),
        ...(p.product_url ? { target_product_url: p.product_url } : {}),
        ...(p.target_item_id ? { target_item_id: p.target_item_id } : {}),
        ...(p.model_number ? { model_number: p.model_number } : {}),
        ...(p.upc_or_gtin ? { upc_or_gtin: p.upc_or_gtin } : {}),
      },
      {
        sqliteDb: deps.sqliteDb,
        env: deps.env,
        now,
        offersOverride: deps.offersOverride,
      },
    );
    if (!discovered.ok || discovered.candidates.length === 0) {
      return incomplete(stage, journey.id);
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "candidate_id",
      discoverySessionId: discovered.discovery_session_id,
      nowIso,
    });
    const candidateMessage = discovered.candidates
      .map((candidate) => `${candidate.candidate_id}: ${candidate.title}`)
      .join("; ");
    return incomplete(
      "candidate_id",
      journey.id,
      `Choose the exact Target product candidate: ${candidateMessage}`,
    );
  }

  if (stage === "candidate_id") {
    const candidateId = cleanString(raw.candidate_id);
    if (!candidateId || !journey.discovery_session_id) return incomplete(stage, journey.id);
    const confirmed = await confirmProductForAgent({
      discoverySessionId: journey.discovery_session_id,
      candidateId,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now,
    });
    if (!confirmed.ok) return incomplete(stage, journey.id);
    const session = await store.getDiscoverySessionById(journey.discovery_session_id);
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "email",
      fingerprintId: session?.locked_fingerprint_snapshot_json
        ? sha256Hex(session.locked_fingerprint_snapshot_json)
        : null,
      nowIso,
    });
    return incomplete("email", journey.id);
  }

  if (stage === "email") {
    const email = cleanString(raw.email);
    if (!email) return incomplete(stage, journey.id);
    const begun = await beginAgentEmailVerification({
      email,
      sourceKey: deps.sourceKey,
      now,
      env: deps.env,
      sqliteDb: deps.sqliteDb,
    });
    if (!begun.ok) return incomplete(stage, journey.id);
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "verification_code",
      connectionId: begun.connection_id,
      nowIso,
    });
    return incomplete("verification_code", journey.id);
  }

  if (stage === "verification_code") {
    const code = cleanString(raw.verification_code || raw.code);
    if (!code || !journey.connection_id) return incomplete(stage, journey.id);
    const verified = await verifyAgentEmailCode({
      connectionId: journey.connection_id,
      code,
      now,
      env: deps.env,
      sqliteDb: deps.sqliteDb,
    });
    if (!verified.ok) return incomplete(stage, journey.id);
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "consents",
      nowIso,
    });
    return incomplete("consents", journey.id);
  }

  if (
    raw.monitoring_consent !== true ||
    raw.email_alert_consent !== true ||
    !journey.connection_id ||
    !journey.discovery_session_id
  ) {
    return incomplete("consents", journey.id);
  }
  const preflight = await preflightMonitoringForAgent({
    connectionId: journey.connection_id,
    trustedMarketplaceJourney: true,
    discoverySessionId: journey.discovery_session_id,
    monitoringConsent: true,
    emailAlertConsent: true,
    now,
    sqliteDb: deps.sqliteDb,
    env: deps.env,
  });
  if (!preflight.ok) return incomplete("consents", journey.id);
  await store.updateMarketplacePurchaseJourney({
    id: journey.id,
    stage: "consents",
    quoteId: preflight.quote_id,
    nowIso,
  });
  const redeemed = await redeemMonitoringPassForAgent({
    monitoringPassId: journey.monitoring_pass_id,
    quoteId: preflight.quote_id,
    connectionId: journey.connection_id,
    trustedMarketplaceJourney: true,
    now,
    sqliteDb: deps.sqliteDb,
    env: deps.env,
  });
  if (!redeemed.ok || redeemed.status === "ACTIVATION_PENDING") {
    return incomplete("consents", journey.id);
  }
  await store.updateMarketplacePurchaseJourney({
    id: journey.id,
    stage: "complete",
    quoteId: preflight.quote_id,
    nowIso,
  });
  return {
    http_status: 200,
    body: {
      status: "MONITORING_ACTIVE",
      journey_id: journey.id,
      fields: [],
      requiredArgs: [],
      message:
        "Monitoring is active. A lower price, alert, or adjustment is never guaranteed.",
    },
  };
}