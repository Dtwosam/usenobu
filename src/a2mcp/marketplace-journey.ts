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
  marketplaceActivationPendingContract,
  marketplaceIncompleteContract,
  marketplaceMonitoringActiveContract,
  marketplaceMoreInformationRequired,
  type MarketplaceStage,
} from "./conversation-contract.js";
import {
  internalContinuationStateMissing,
} from "./protocol-continuation.js";
import {
  buildServiceSelectionRequired,
  FREE_SERVICE_ID,
  PAID_SERVICE_ID,
  resolveFreeServiceEndpoint,
} from "./service-catalogue.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type MarketplaceJourneyDeps = Omit<UnderstandDeps, "now"> & {
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  sourceKey?: string;
  now?: Date;
  offersOverride?: MatchableOffer[];
};

type JourneyStage = MarketplaceStage | "activation_pending" | "complete";

type PurchaseSnapshot = {
  purchase_price: number;
  purchase_date: string;
  purchase_channel: "target_online";
  country: "US";
  region?: string;
  product_title?: string;
  target_product_url?: string;
  target_item_id?: string;
  model_number?: string;
  upc_or_gtin?: string;
};

/** Partial clue storage — price/date may be absent until the user supplies them. */
type PartialPurchaseClue = {
  purchase_price?: number | null;
  purchase_date?: string | null;
  purchase_channel?: "target_online";
  country?: "US";
  region?: string;
  product_title?: string;
  target_product_url?: string;
  target_item_id?: string;
  model_number?: string;
  upc_or_gtin?: string;
  /** Marker so partial rows are not treated as complete snapshots. */
  _partial?: true;
};

function incomplete(
  stage: MarketplaceStage,
  journeyId: string,
  message?: string,
  extras?: {
    passContinuationId?: string | null;
    monitoringPassId?: string | null;
    env?: EnvRecord;
    candidatesMessage?: string;
    continuationBodyExtras?: Record<string, unknown>;
    sensitiveFields?: string[];
  },
) {
  const contract = marketplaceIncompleteContract({
    stage,
    journeyId,
    message,
    passContinuationId: extras?.passContinuationId,
    monitoringPassId: extras?.monitoringPassId,
    env: extras?.env,
    candidatesMessage: extras?.candidatesMessage,
    continuationBodyExtras: extras?.continuationBodyExtras,
    sensitiveFields: extras?.sensitiveFields,
  });
  // Automatic stages use 200 so buyer agents auto-continue without treating
  // the response as a human field-collection error.
  const http_status = contract.automatic_continue ? 200 : 400;
  return {
    http_status: http_status as 200 | 400,
    body: {
      ...contract,
      journey_id: journeyId,
      free_service_endpoint: resolveFreeServiceEndpoint(extras?.env),
    },
  };
}

function parsePurchaseSnapshot(raw: string | null | undefined): PurchaseSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PurchaseSnapshot & PartialPurchaseClue;
    if (parsed._partial) return null;
    if (
      typeof parsed.purchase_price !== "number" ||
      !Number.isFinite(parsed.purchase_price) ||
      typeof parsed.purchase_date !== "string" ||
      !parsed.purchase_date
    ) {
      return null;
    }
    return parsed as PurchaseSnapshot;
  } catch {
    return null;
  }
}

function parsePartialClue(raw: string | null | undefined): PartialPurchaseClue | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PartialPurchaseClue;
  } catch {
    return null;
  }
}

function snapshotFromExtracted(p: {
  purchase_price?: number | null;
  purchase_date?: string | null;
  region?: string | null;
  product_description?: string | null;
  product_url?: string | null;
  target_item_id?: string | null;
  model_number?: string | null;
  upc_or_gtin?: string | null;
}): PurchaseSnapshot {
  return {
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
  };
}

async function runProductDiscoveryForSnapshot(
  snapshot: PurchaseSnapshot,
  deps: MarketplaceJourneyDeps,
  now: Date,
): Promise<Awaited<ReturnType<typeof discoverProductForAgent>>> {
  return discoverProductForAgent(
    {
      purchase_price: snapshot.purchase_price,
      purchase_date: snapshot.purchase_date,
      purchase_channel: snapshot.purchase_channel,
      country: snapshot.country,
      ...(snapshot.region ? { region: snapshot.region } : {}),
      ...(snapshot.product_title ? { product_title: snapshot.product_title } : {}),
      ...(snapshot.target_product_url
        ? { target_product_url: snapshot.target_product_url }
        : {}),
      ...(snapshot.target_item_id ? { target_item_id: snapshot.target_item_id } : {}),
      ...(snapshot.model_number ? { model_number: snapshot.model_number } : {}),
      ...(snapshot.upc_or_gtin ? { upc_or_gtin: snapshot.upc_or_gtin } : {}),
    },
    {
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now,
      offersOverride: deps.offersOverride,
    },
  );
}

function newJourneyId(): string {
  return `journey_${randomUUID().replace(/-/g, "")}`;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasForbiddenEarlyInput(raw: Record<string, unknown>, stage: JourneyStage): boolean {
  if (stage === "activation_pending" || stage === "complete") return false;
  const order: JourneyStage[] = [
    "confirm_use_pass",
    "purchase_description",
    "product_discovery",
    "candidate_id",
    "email",
    "verification_code",
    "consents",
    "complete",
  ];
  const at = order.indexOf(stage);
  if (at < 0) return false;
  if (at < order.indexOf("email") && "email" in raw) return true;
  if (
    at < order.indexOf("consents") &&
    ("monitoring_consent" in raw || "email_alert_consent" in raw)
  ) return true;
  return false;
}

function activationPendingResponse(
  journeyId: string,
  extras: {
    passContinuationId?: string | null;
    monitoringPassId?: string | null;
    env?: EnvRecord;
    connectionToken: string;
  },
) {
  const contract = marketplaceActivationPendingContract({
    journeyId,
    connectionToken: extras.connectionToken,
    monitoringPassId: extras.monitoringPassId,
    passContinuationId: extras.passContinuationId,
    env: extras.env,
  });
  return {
    http_status: 200 as const,
    body: {
      ...contract,
      journey_id: journeyId,
      free_service_endpoint: resolveFreeServiceEndpoint(extras.env),
    },
  };
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

/**
 * Marketplace path without a pass reference: present both services.
 * Never assume paid service 35958 or require payment before service choice.
 */
export function marketplaceFirstContact() {
  const selection = buildServiceSelectionRequired();
  return {
    http_status: 400 as const,
    body: {
      ...selection,
      journey_id: "",
      // Callers mid-journey with an existing pass may still send these after
      // selecting free Purchase Setup; they are not required before choice.
      optional_pass_fields: ["monitoring_pass_id", "pass_continuation_id"],
      free_service_id: FREE_SERVICE_ID,
      paid_service_id: PAID_SERVICE_ID,
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
    const claimCredential = cleanString(
      raw.pass_claim_credential || raw.claim_credential,
    );
    if (!passId && !continuationId) return marketplaceFirstContact();
    // Public pass/journey ids alone cannot claim — require single-use claim
    // credential when the continuation was issued with one.
    const resolution = await resolveMonitoringPassForAgent({
      monitoringPassId: passId || undefined,
      passContinuationId: continuationId || undefined,
      passClaimCredential: claimCredential || undefined,
      now,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
    });
    if (resolution.http_status === 401) {
      return {
        http_status: 401,
        body: {
          status: "CLAIM_NOT_AUTHORIZED",
          message:
            "A valid single-use pass_claim_credential is required to start Purchase Setup. Public pass ids alone cannot claim a pass.",
          monitoring_active: false,
          second_payment_required: false,
        },
      };
    }
    // Resolve is read-only and never sets claim_authorized. When a claim
    // credential is required, only claimPassAndCreateJourney may authorize.
    // Public ids without a credential cannot create a journey.
    if (
      resolution.http_status === 200 &&
      resolution.body.status === "MONITORING_PASS_ISSUED" &&
      resolution.body.claim_required === true &&
      !claimCredential
    ) {
      return {
        http_status: 401,
        body: {
          status: "CLAIM_NOT_AUTHORIZED",
          message:
            "pass_claim_credential is required to start Purchase Setup. Public monitoring_pass_id alone cannot claim a pass.",
          monitoring_active: false,
          second_payment_required: false,
          claim_required: true,
        },
      };
    }
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
            next_service_id: pending ? FREE_SERVICE_ID : PAID_SERVICE_ID,
          }),
          journey_id: "",
          fields: [referenceField],
          requiredArgs: [referenceField],
        },
      };
    }
    const contIdForClaim =
      typeof resolution.body.pass_continuation_id === "string"
        ? resolution.body.pass_continuation_id
        : continuationId;
    // Atomic claim + journey: never consume claim without creating journey.
    if (claimCredential && contIdForClaim) {
      const { sha256Hex } = await import("../auth/crypto.js");
      const claimed = await store.claimPassAndCreateJourney({
        continuationId: contIdForClaim,
        claimCredentialHash: sha256Hex(claimCredential),
        journeyId: newJourneyId(),
        monitoringPassId: resolution.body.monitoring_pass_id,
        nowIso,
      });
      if (claimed.outcome === "claim_invalid") {
        return {
          http_status: 401,
          body: {
            status: "CLAIM_NOT_AUTHORIZED",
            message:
              "Invalid or already-used pass_claim_credential. Public pass ids alone cannot claim a pass.",
            monitoring_active: false,
            second_payment_required: false,
          },
        };
      }
      if (claimed.outcome === "pass_mismatch") {
        return {
          http_status: 401,
          body: {
            status: "CLAIM_NOT_AUTHORIZED",
            message: "Pass and continuation do not match.",
            monitoring_active: false,
            second_payment_required: false,
          },
        };
      }
      journey = claimed.journey;
    } else {
      // No legacy public-ID journey path — claim credential is always required.
      return {
        http_status: 401,
        body: {
          status: "CLAIM_NOT_AUTHORIZED",
          message:
            "pass_claim_credential is required to start Purchase Setup. Public pass or continuation ids alone cannot create a journey.",
          monitoring_active: false,
          second_payment_required: false,
          claim_required: true,
        },
      };
    }
  }

  const journeyExtras = {
    passContinuationId: journey.pass_continuation_id,
    monitoringPassId: journey.monitoring_pass_id,
  };

  const stage = journey.stage as JourneyStage;
  const stageExtras = {
    ...journeyExtras,
    env: deps.env,
  };

  if (stage === "complete") {
    return {
      http_status: 200,
      body: {
        ...marketplaceMonitoringActiveContract({
          journeyId: journey.id,
          monitoringPassId: journey.monitoring_pass_id,
          passContinuationId: journey.pass_continuation_id,
        }),
        journey_id: journey.id,
        fields: [],
        requiredArgs: [],
        required_fields: [],
        input_required: false,
        automatic_continue: false,
        protocol_continuation: null,
        machine_continuation: null,
      },
    };
  }

  // Resume projection after pass redemption without re-preflight or re-redeem.
  if (stage === "activation_pending") {
    if (
      !journey.quote_id ||
      !journey.connection_id ||
      !journey.monitoring_pass_id
    ) {
      return {
        http_status: 400,
        body: {
          ...internalContinuationStateMissing({
            journeyId: journey.id,
            monitoringPassId: journey.monitoring_pass_id,
          }),
          free_service_endpoint: resolveFreeServiceEndpoint(deps.env),
        },
      };
    }
    // Idempotent: existing activation is resolved; no new quote/pass consume.
    // connection_token is machine-owned and must arrive via protocol_continuation.
    const resumeToken = cleanString(raw.connection_token);
    if (!resumeToken) {
      return {
        http_status: 400,
        body: {
          ...internalContinuationStateMissing({
            journeyId: journey.id,
            monitoringPassId: journey.monitoring_pass_id,
          }),
          free_service_endpoint: resolveFreeServiceEndpoint(deps.env),
        },
      };
    }
    const resumed = await redeemMonitoringPassForAgent({
      monitoringPassId: journey.monitoring_pass_id,
      quoteId: journey.quote_id,
      connectionId: journey.connection_id,
      connectionToken: resumeToken,
      now,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
    });
    if (
      resumed.ok &&
      (resumed.status === "MONITORING_STARTED" ||
        resumed.status === "ALREADY_ACTIVE")
    ) {
      await store.updateMarketplacePurchaseJourney({
        id: journey.id,
        stage: "complete",
        quoteId: journey.quote_id,
        nowIso,
      });
      return {
        http_status: 200,
        body: {
          ...marketplaceMonitoringActiveContract({
            journeyId: journey.id,
            monitoringPassId: journey.monitoring_pass_id,
            passContinuationId: journey.pass_continuation_id,
          }),
          journey_id: journey.id,
          fields: [],
          requiredArgs: [],
          required_fields: [],
          input_required: false,
          automatic_continue: false,
          protocol_continuation: null,
          machine_continuation: null,
        },
      };
    }
    if (resumed.ok && resumed.status === "ACTIVATION_PENDING") {
      return activationPendingResponse(journey.id, {
        ...stageExtras,
        connectionToken: resumeToken,
      });
    }
    return {
      http_status: 400,
      body: {
        ...buildConversationContract({
          status: "ACTIVATION_BLOCKED",
          current_step: "activation_pending",
          completed_step: "MONITORING_ACTIVATION_PENDING",
          next_action: "CONTACT_SUPPORT_WITH_JOURNEY_ID",
          message:
            "Activation could not complete for this journey. Do not pay again. Do not redeem again.",
          guidance:
            "A conclusive activation failure was recorded. Never open a second payment. Keep journey_id and monitoring_pass_id for support.",
          payment_status: "recognized",
          second_payment_required: false,
          monitoring_active: false,
          journey_complete: false,
          retry_safe: false,
          required_fields: [],
          required_user_input: null,
          input_required: false,
          automatic_continue: false,
          protocol_continuation: null,
          machine_continuation: null,
          journey_id: journey.id,
          monitoring_pass_id: journey.monitoring_pass_id,
          next_service_id: FREE_SERVICE_ID,
        }),
        journey_id: journey.id,
        fields: [],
        requiredArgs: [],
        second_payment_required: false,
      },
    };
  }

  if (hasForbiddenEarlyInput(raw, stage)) {
    return incomplete(stage, journey.id, undefined, stageExtras);
  }

  if (stage === "confirm_use_pass") {
    if (raw.confirm_use_pass !== true) {
      return incomplete(stage, journey.id, undefined, stageExtras);
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "purchase_description",
      nowIso,
    });
    return incomplete("purchase_description", journey.id, undefined, stageExtras);
  }

  if (stage === "purchase_description") {
    const description = cleanString(raw.purchase_description || raw.purchase_text);
    if (!description) return incomplete(stage, journey.id, undefined, stageExtras);
    // Extract only — product discovery is a separate automatic stage.
    const understood = await understandPurchase(description, {
      llm: deps.llm,
      forceDeterministic: deps.forceDeterministic,
      forceUnavailable: deps.forceUnavailable,
      now: () => now,
    });
    // Preserve any product clue (URL/TCIN/model) already present when price/date missing.
    const priorComplete = parsePurchaseSnapshot(journey.purchase_snapshot_json);
    const priorPartial = parsePartialClue(journey.purchase_snapshot_json);
    const prior = priorComplete ?? priorPartial;
    const extracted = understood.ok ? understood.body.extracted_purchase : null;
    const mergedPartial = {
      purchase_price:
        (typeof extracted?.purchase_price === "number"
          ? extracted.purchase_price
          : null) ??
        (typeof prior?.purchase_price === "number" ? prior.purchase_price : null),
      purchase_date:
        extracted?.purchase_date ||
        prior?.purchase_date ||
        null,
      region: extracted?.region ?? prior?.region ?? null,
      product_description:
        extracted?.product_description ??
        (prior && "product_title" in prior ? prior.product_title : null) ??
        null,
      product_url:
        extracted?.product_url ??
        (prior && "target_product_url" in prior
          ? prior.target_product_url
          : null) ??
        null,
      target_item_id:
        extracted?.target_item_id ?? prior?.target_item_id ?? null,
      model_number: extracted?.model_number ?? prior?.model_number ?? null,
      upc_or_gtin: extracted?.upc_or_gtin ?? prior?.upc_or_gtin ?? null,
    };
    const missing: string[] = [];
    if (
      typeof mergedPartial.purchase_price !== "number" ||
      !Number.isFinite(mergedPartial.purchase_price) ||
      mergedPartial.purchase_price <= 0
    ) {
      missing.push("actual purchase price");
    }
    if (!mergedPartial.purchase_date) missing.push("actual purchase date");
    const hasProductClue = !!(
      mergedPartial.product_url ||
      mergedPartial.target_item_id ||
      mergedPartial.model_number ||
      mergedPartial.product_description
    );
    if (!hasProductClue) {
      missing.push("product URL, TCIN, model, or clear description");
    }
    if (missing.length > 0) {
      // Persist partial clue so a later reply with only price/date does not drop URL.
      if (hasProductClue || mergedPartial.purchase_price || mergedPartial.purchase_date) {
        const partialSnapshot: PartialPurchaseClue = {
          _partial: true,
          purchase_channel: "target_online",
          country: "US",
          ...(typeof mergedPartial.purchase_price === "number"
            ? { purchase_price: mergedPartial.purchase_price }
            : {}),
          ...(mergedPartial.purchase_date
            ? { purchase_date: mergedPartial.purchase_date }
            : {}),
          ...(mergedPartial.region ? { region: mergedPartial.region } : {}),
          ...(mergedPartial.product_description
            ? { product_title: mergedPartial.product_description }
            : {}),
          ...(mergedPartial.product_url
            ? { target_product_url: mergedPartial.product_url }
            : {}),
          ...(mergedPartial.target_item_id
            ? { target_item_id: mergedPartial.target_item_id }
            : {}),
          ...(mergedPartial.model_number
            ? { model_number: mergedPartial.model_number }
            : {}),
          ...(mergedPartial.upc_or_gtin
            ? { upc_or_gtin: mergedPartial.upc_or_gtin }
            : {}),
        };
        await store.updateMarketplacePurchaseJourney({
          id: journey.id,
          stage: "purchase_description",
          purchaseSnapshotJson: JSON.stringify(partialSnapshot),
          nowIso,
        });
      }
      const hasUrlOnly =
        !!mergedPartial.product_url &&
        missing.every((m) => m.includes("price") || m.includes("date"));
      return incomplete(
        stage,
        journey.id,
        hasUrlOnly
          ? "A product URL was saved. Provide the actual purchase price and actual purchase date for that Target online purchase. Custom alert thresholds are not supported."
          : `Could not extract enough purchase details. Still needed: ${missing.join(", ")}. Describe an actual recent Target.com online purchase.`,
        stageExtras,
      );
    }
    const snapshot = snapshotFromExtracted({
      purchase_price: mergedPartial.purchase_price as number,
      purchase_date: mergedPartial.purchase_date as string,
      region: mergedPartial.region,
      product_description: mergedPartial.product_description,
      product_url: mergedPartial.product_url,
      target_item_id: mergedPartial.target_item_id,
      model_number: mergedPartial.model_number,
      upc_or_gtin: mergedPartial.upc_or_gtin,
    });
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "product_discovery",
      purchaseSnapshotJson: JSON.stringify(snapshot),
      nowIso,
    });
    // Automatic continue — do not ask the user to resubmit journey_id.
    return incomplete("product_discovery", journey.id, undefined, stageExtras);
  }

  if (stage === "product_discovery") {
    // Optional re-description replaces the snapshot, then discovery runs.
    const reDescription = cleanString(raw.purchase_description || raw.purchase_text);
    let snapshot = parsePurchaseSnapshot(journey.purchase_snapshot_json);
    if (reDescription) {
      const understood = await understandPurchase(reDescription, {
        llm: deps.llm,
        forceDeterministic: deps.forceDeterministic,
        forceUnavailable: deps.forceUnavailable,
        now: () => now,
      });
      if (!understood.ok || understood.body.missing_fields.length > 0) {
        return incomplete(
          "purchase_description",
          journey.id,
          "Could not extract enough purchase details. Provide price, date, and a product clue for a recent Target online purchase.",
          stageExtras,
        );
      }
      snapshot = snapshotFromExtracted(understood.body.extracted_purchase);
      await store.updateMarketplacePurchaseJourney({
        id: journey.id,
        stage: "product_discovery",
        purchaseSnapshotJson: JSON.stringify(snapshot),
        nowIso,
      });
    }
    if (!snapshot) {
      return incomplete(
        "purchase_description",
        journey.id,
        "Purchase details are missing. Describe the recent Target online purchase again.",
        stageExtras,
      );
    }

    const discovered = await runProductDiscoveryForSnapshot(snapshot, deps, now);
    if (!discovered.ok || discovered.candidates.length === 0) {
      // Stop automatic SerpApi loops — ask for a clearer product clue once.
      await store.updateMarketplacePurchaseJourney({
        id: journey.id,
        stage: "purchase_description",
        nowIso,
      });
      const moreInfo = marketplaceMoreInformationRequired({
        journeyId: journey.id,
        passContinuationId: journeyExtras.passContinuationId,
        monitoringPassId: journeyExtras.monitoringPassId,
        env: deps.env,
      });
      return {
        http_status: 400 as const,
        body: {
          ...moreInfo,
          journey_id: journey.id,
          free_service_endpoint: resolveFreeServiceEndpoint(deps.env),
        },
      };
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "candidate_id",
      discoverySessionId: discovered.discovery_session_id,
      nowIso,
    });
    const candidateMessage = `Choose the exact Target product candidate: ${discovered.candidates
      .map((candidate) => `${candidate.candidate_id}: ${candidate.title}`)
      .join("; ")}`;
    return incomplete("candidate_id", journey.id, candidateMessage, {
      ...stageExtras,
      candidatesMessage: candidateMessage,
    });
  }

  if (stage === "candidate_id") {
    if (!journey.discovery_session_id) {
      return {
        http_status: 400,
        body: {
          ...internalContinuationStateMissing({
            journeyId: journey.id,
            monitoringPassId: journey.monitoring_pass_id,
          }),
          free_service_endpoint: resolveFreeServiceEndpoint(deps.env),
        },
      };
    }
    const candidateId = cleanString(raw.candidate_id);
    if (!candidateId) {
      return incomplete(stage, journey.id, undefined, stageExtras);
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
        stageExtras,
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
    return incomplete("email", journey.id, undefined, stageExtras);
  }

  if (stage === "email") {
    const email = cleanString(raw.email);
    if (!email) return incomplete(stage, journey.id, undefined, stageExtras);
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
        stageExtras,
      );
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "verification_code",
      connectionId: begun.connection_id,
      nowIso,
    });
    return incomplete("verification_code", journey.id, undefined, stageExtras);
  }

  if (stage === "verification_code") {
    const code = cleanString(raw.verification_code || raw.code);
    if (!code || !journey.connection_id) {
      return incomplete(stage, journey.id, undefined, stageExtras);
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
        stageExtras,
      );
    }
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "consents",
      nowIso,
    });
    // connection_token is machine-owned: only inside protocol_continuation.body.
    // Buyer agent asks only for the two consents (merge_user_fields).
    return incomplete("consents", journey.id, undefined, {
      ...stageExtras,
      continuationBodyExtras: {
        connection_token: verified.connection_token,
      },
      sensitiveFields: ["connection_token"],
    });
  }

  if (
    raw.monitoring_consent !== true ||
    raw.email_alert_consent !== true ||
    !journey.connection_id ||
    !journey.discovery_session_id
  ) {
    // If consents incomplete but token present, keep it in continuation.
    const heldToken = cleanString(raw.connection_token);
    return incomplete("consents", journey.id, undefined, {
      ...stageExtras,
      ...(heldToken
        ? {
            continuationBodyExtras: { connection_token: heldToken },
            sensitiveFields: ["connection_token"],
          }
        : {}),
    });
  }
  // After email verification the connection-token boundary is authoritative.
  // Token must arrive via protocol_continuation — never ask the user for it.
  const connectionToken = cleanString(raw.connection_token);
  if (!connectionToken) {
    return {
      http_status: 400,
      body: {
        ...internalContinuationStateMissing({
          journeyId: journey.id,
          monitoringPassId: journey.monitoring_pass_id,
        }),
        free_service_endpoint: resolveFreeServiceEndpoint(deps.env),
      },
    };
  }
  if (!journey.discovery_session_id) {
    return {
      http_status: 400,
      body: {
        ...internalContinuationStateMissing({
          journeyId: journey.id,
          monitoringPassId: journey.monitoring_pass_id,
        }),
        free_service_endpoint: resolveFreeServiceEndpoint(deps.env),
      },
    };
  }
  // Eligibility preflight + pass redemption are provider-controlled automatic steps.
  const preflight = await preflightMonitoringForAgent({
    connectionId: journey.connection_id,
    connectionToken,
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
      stageExtras,
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
    connectionToken,
    now,
    sqliteDb: deps.sqliteDb,
    env: deps.env,
  });
  if (!redeemed.ok) {
    return incomplete(
      "consents",
      journey.id,
      "The Monitoring Pass could not be redeemed. Do not pay again. Retry consents/preflight if the pass is still unused, or resolve pass status first.",
      stageExtras,
    );
  }
  if (redeemed.status === "ACTIVATION_PENDING") {
    await store.updateMarketplacePurchaseJourney({
      id: journey.id,
      stage: "activation_pending",
      quoteId: preflight.quote_id,
      nowIso,
    });
    return activationPendingResponse(journey.id, {
      ...stageExtras,
      monitoringPassId: journey.monitoring_pass_id,
      passContinuationId: journey.pass_continuation_id,
      connectionToken,
    });
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
      ...marketplaceMonitoringActiveContract({
        journeyId: journey.id,
        monitoringPassId: journey.monitoring_pass_id,
        passContinuationId: journey.pass_continuation_id,
      }),
      journey_id: journey.id,
      fields: [],
      requiredArgs: [],
      required_fields: [],
      input_required: false,
      automatic_continue: false,
      protocol_continuation: null,
      machine_continuation: null,
    },
  };
}