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
import {
  buildConversationContract,
  marketplaceIncompleteContract,
} from "./conversation-contract.js";

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

function incomplete(
  stage: Exclude<JourneyStage, "complete">,
  journeyId: string,
  message?: string,
  extras?: {
    passContinuationId?: string | null;
    monitoringPassId?: string | null;
  },
) {
  const contract = marketplaceIncompleteContract({
    stage,
    journeyId,
    message,
    passContinuationId: extras?.passContinuationId,
    monitoringPassId: extras?.monitoringPassId,
  });
  return {
    http_status: 400 as const,
    body: {
      ...contract,
      journey_id: journeyId,
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
  const contract = buildConversationContract({
    status: "input_required",
    completed_step: "NOBU_INTRODUCED",
    next_action: "PROVIDE_MONITORING_PASS",
    message:
      "Nobu is an AI post-purchase monitoring agent for Target online purchases. Purchase Setup is free. A Monitoring Pass costs 0.99 USDT and does not start monitoring by itself. Provide monitoring_pass_id or pass_continuation_id if you already paid; otherwise buy one pass on service 35958 once.",
    guidance:
      "If the user has no pass, route them to service 35958 (Nobu Monitoring Pass, 0.99 USDT) once — never invent a second charge after settlement. If they already paid, send monitoring_pass_id or pass_continuation_id here. Do not request email or consent yet. Target makes any final adjustment decision.",
    payment_status: "required",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    required_fields: null,
    required_user_input: {
      required_fields: ["monitoring_pass_id"],
      optional_fields: ["pass_continuation_id"],
      description:
        "Public monitoring_pass_id or pass_continuation_id after payment. If none, use service 35958 once.",
    },
    extra_fields: ["monitoring_pass_id"],
    next_service_id: 33561,
  });
  return {
    http_status: 400 as const,
    body: {
      ...contract,
      journey_id: "",
      fields: ["monitoring_pass_id"],
      requiredArgs: ["monitoring_pass_id"],
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
      const pending = resolution.body.status === "PAYMENT_SETTLEMENT_PENDING";
      const cont =
        typeof resolution.body.pass_continuation_id === "string"
          ? resolution.body.pass_continuation_id
          : continuationId || null;
      return {
        http_status: 400,
        body: {
          ...buildConversationContract({
            status: "input_required",
            completed_step: pending ? "PAYMENT_SUBMITTED" : "MONITORING_PASS_LOOKUP",
            next_action: pending ? "RESOLVE_MONITORING_PASS" : "PROVIDE_MONITORING_PASS",
            message: pending
              ? "Settlement is still confirming. Do not pay again; retry this same pass reference later."
              : "That Monitoring Pass could not be resolved. Check the pass reference and try again.",
            guidance: pending
              ? "Keep the same pass_continuation_id. Nobu will issue the pass when settlement confirms. Never open a second payment."
              : "If the user has no pass, route them to service 35958 once. If they just paid, retry with pass_continuation_id.",
            payment_status: pending ? "pending" : "required",
            second_payment_required: false,
            monitoring_active: false,
            journey_complete: false,
            retry_safe: true,
            required_fields: null,
            required_user_input: {
              required_fields: [referenceField],
              description: pending
                ? "Retry with the same pass_continuation_id."
                : "Provide a valid monitoring_pass_id or pass_continuation_id.",
            },
            extra_fields: [referenceField],
            pass_continuation_id: cont,
            next_service_id: pending ? 33561 : 35958,
          }),
          journey_id: "",
          fields: [referenceField],
          requiredArgs: [referenceField],
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

  const journeyExtras = {
    passContinuationId: journey.pass_continuation_id,
    monitoringPassId: journey.monitoring_pass_id,
  };

  const stage = journey.stage as JourneyStage;
  if (stage === "complete") {
    return {
      http_status: 200,
      body: {
        ...buildConversationContract({
          status: "MONITORING_ACTIVE",
          completed_step: "MONITORING_PASS_REDEEMED",
          next_action: "CHECK_MONITORING_STATUS",
          message:
            "Monitoring is active. A lower price, alert, or adjustment is never guaranteed. Target makes the final decision.",
          guidance:
            "Monitoring is active. Status can be checked later. Stopping keeps history and never implies a refund.",
          payment_status: "recognized",
          second_payment_required: false,
          monitoring_active: true,
          journey_complete: true,
          retry_safe: true,
          required_fields: null,
          required_user_input: null,
          journey_id: journey.id,
          monitoring_pass_id: journey.monitoring_pass_id,
          pass_continuation_id: journey.pass_continuation_id,
          next_service_id: 33561,
        }),
        journey_id: journey.id,
        fields: [],
        requiredArgs: [],
      },
    };
  }
  if (hasForbiddenEarlyInput(raw, stage)) {
    return incomplete(stage, journey.id, undefined, journeyExtras);
  }

  if (stage === "confirm_use_pass") {
    if (raw.confirm_use_pass !== true) {
      return incomplete(stage, journey.id, undefined, journeyExtras);
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "purchase_description",
      nowIso,
    });
    return incomplete("purchase_description", journey.id, undefined, journeyExtras);
  }

  if (stage === "purchase_description") {
    const description = cleanString(raw.purchase_description || raw.purchase_text);
    if (!description) return incomplete(stage, journey.id, undefined, journeyExtras);
    const understood = await understandPurchase(description, {
      llm: deps.llm,
      forceDeterministic: deps.forceDeterministic,
      forceUnavailable: deps.forceUnavailable,
      now: () => now,
    });
    if (!understood.ok || understood.body.missing_fields.length > 0) {
      return incomplete(
        stage,
        journey.id,
        "Nobu could not extract enough purchase details. Provide price, date, and a product clue for a recent Target online purchase.",
        journeyExtras,
      );
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
      return incomplete(
        stage,
        journey.id,
        "No safe Target product candidate was found. Add a Target URL, TCIN, model, or clearer description and retry. Monitoring is not active.",
        journeyExtras,
      );
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
      journeyExtras,
    );
  }

  if (stage === "candidate_id") {
    const candidateId = cleanString(raw.candidate_id);
    if (!candidateId || !journey.discovery_session_id) {
      return incomplete(stage, journey.id, undefined, journeyExtras);
    }
    const confirmed = await confirmProductForAgent({
      discoverySessionId: journey.discovery_session_id,
      candidateId,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now,
    });
    if (!confirmed.ok) {
      return incomplete(
        stage,
        journey.id,
        "That candidate could not be confirmed. Choose an exact Target-sold candidate from the list, or return with a clearer purchase description.",
        journeyExtras,
      );
    }
    const session = await store.getDiscoverySessionById(journey.discovery_session_id);
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "email",
      fingerprintId: session?.locked_fingerprint_snapshot_json
        ? sha256Hex(session.locked_fingerprint_snapshot_json)
        : null,
      nowIso,
    });
    return incomplete("email", journey.id, undefined, journeyExtras);
  }

  if (stage === "email") {
    const email = cleanString(raw.email);
    if (!email) return incomplete(stage, journey.id, undefined, journeyExtras);
    const begun = await beginAgentEmailVerification({
      email,
      sourceKey: deps.sourceKey,
      now,
      env: deps.env,
      sqliteDb: deps.sqliteDb,
    });
    if (!begun.ok) {
      return incomplete(
        stage,
        journey.id,
        "Email verification could not start. Provide a valid email you control, or wait if rate-limited.",
        journeyExtras,
      );
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "verification_code",
      connectionId: begun.connection_id,
      nowIso,
    });
    return incomplete("verification_code", journey.id, undefined, journeyExtras);
  }

  if (stage === "verification_code") {
    const code = cleanString(raw.verification_code || raw.code);
    if (!code || !journey.connection_id) {
      return incomplete(stage, journey.id, undefined, journeyExtras);
    }
    const verified = await verifyAgentEmailCode({
      connectionId: journey.connection_id,
      code,
      now,
      env: deps.env,
      sqliteDb: deps.sqliteDb,
    });
    if (!verified.ok) {
      return incomplete(
        stage,
        journey.id,
        "That verification code was not accepted. Enter the current six-digit code, or request a new email code.",
        journeyExtras,
      );
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "consents",
      nowIso,
    });
    return incomplete("consents", journey.id, undefined, journeyExtras);
  }

  if (
    raw.monitoring_consent !== true ||
    raw.email_alert_consent !== true ||
    !journey.connection_id ||
    !journey.discovery_session_id
  ) {
    return incomplete("consents", journey.id, undefined, journeyExtras);
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
  if (!preflight.ok) {
    return incomplete(
      "consents",
      journey.id,
      "Eligibility or consent preflight did not pass. Confirm both consents and that the purchase is an eligible Target online purchase within the policy window.",
      journeyExtras,
    );
  }
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
  if (!redeemed.ok) {
    return incomplete(
      "consents",
      journey.id,
      "The Monitoring Pass could not be redeemed. Do not pay again. Retry consents/preflight if the pass is still unused, or resolve pass status first.",
      journeyExtras,
    );
  }
  if (redeemed.status === "ACTIVATION_PENDING") {
    return {
      http_status: 200,
      body: {
        ...buildConversationContract({
          status: "ACTIVATION_PENDING",
          completed_step: "MONITORING_ACTIVATION_PENDING",
          next_action: "CHECK_MONITORING_STATUS",
          message:
            "Payment and pass redemption were accepted. Activation is finishing. Do not pay or redeem again.",
          guidance:
            "Retry status shortly with the same journey. Never open a second payment.",
          payment_status: "recognized",
          second_payment_required: false,
          monitoring_active: false,
          journey_complete: false,
          retry_safe: true,
          required_fields: null,
          journey_id: journey.id,
          monitoring_pass_id: journey.monitoring_pass_id,
          next_service_id: 33561,
        }),
        journey_id: journey.id,
        fields: [],
        requiredArgs: [],
      },
    };
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
      ...buildConversationContract({
        status: "MONITORING_ACTIVE",
        completed_step: "MONITORING_PASS_REDEEMED",
        next_action: "CHECK_MONITORING_STATUS",
        message:
          "Monitoring is active. A lower price, alert, or adjustment is never guaranteed. Target makes the final decision.",
        guidance:
          "Monitoring is active. Status can be checked later. Stopping keeps history and never implies a refund.",
        payment_status: "recognized",
        second_payment_required: false,
        monitoring_active: true,
        journey_complete: true,
        retry_safe: true,
        required_fields: null,
        journey_id: journey.id,
        monitoring_pass_id: journey.monitoring_pass_id,
        next_service_id: 33561,
      }),
      journey_id: journey.id,
      fields: [],
      requiredArgs: [],
    },
  };
}