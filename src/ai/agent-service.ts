/**
 * Bounded A2MCP agent — fixed actions only, no open tool loop.
 */
import {
  AgentRequestSchema,
  type AgentRequest,
  type UnderstandPurchaseResponse,
} from "./schemas.js";
import { understandPurchase, type UnderstandDeps } from "./understand-purchase.js";
import {
  runA2mcpTargetPriceCheck,
  type A2mcpCheckDeps,
  type A2mcpCheckResult,
} from "../a2mcp/check-service.js";
import { prepareWebDatabase } from "../web/prepare-db.js";
import type { NobuDatabase } from "../db/index.js";
import {
  beginAgentEmailVerification,
  revokeAgentConnectionAction,
  verifyAgentEmailCode,
} from "../auth/agent-connections.js";
import {
  confirmProductForAgent,
  discoverProductForAgent,
  preflightMonitoringForAgent,
} from "../web/agent-preflight-service.js";
import { redeemMonitoringPassForAgent } from "../payments/redeem-monitoring-pass.js";
import {
  checkMonitoringStatusForAgent,
  listActiveMonitorsForAgent,
  setEmailAlertsForAgent,
  stopMonitoringForAgent,
} from "../web/agent-monitor-management.js";

export type AgentServiceDeps = UnderstandDeps &
  A2mcpCheckDeps & {
    /** Lane 7.4B — inject sqlite db for tests; client source key for rate limits. */
    sqliteDb?: NobuDatabase;
    sourceKey?: string;
    connectionNow?: Date;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  };

export type AgentServiceResult =
  | {
      http_status: 200;
      body: UnderstandPurchaseResponse | Record<string, unknown>;
    }
  | {
      http_status: 400 | 401 | 404 | 429 | 503;
      body: Record<string, unknown>;
    }
  | A2mcpCheckResult;

export async function runAgentAction(
  raw: unknown,
  deps: AgentServiceDeps = {},
): Promise<AgentServiceResult> {
  const parsed = AgentRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      http_status: 400,
      body: {
        error: "invalid_input",
        message: "Invalid agent request.",
        details: parsed.error.flatten(),
      },
    };
  }

  const req: AgentRequest = parsed.data;

  if (req.action === "UNDERSTAND_PURCHASE") {
    const result = await understandPurchase(req.purchase_text, deps);
    if (!result.ok) {
      return {
        http_status: result.http_status,
        body: {
          error: result.error,
          message: result.message,
        },
      };
    }
    // Hard boundary: never attach matching/monitoring results
    return { http_status: 200, body: result.body };
  }

  if (req.action === "CHECK_CONFIRMED_PURCHASE") {
    // Delegate to existing deterministic A2MCP check — same schema/behavior
    const { action: _a, ...purchase } = req;
    return runA2mcpTargetPriceCheck(purchase, deps);
  }

  if (req.action === "BEGIN_EMAIL_VERIFICATION") {
    const result = await beginAgentEmailVerification({
      email: req.email,
      sourceKey: deps.sourceKey,
      now: deps.connectionNow,
      env: deps.env,
      sqliteDb: deps.sqliteDb,
    });
    if (!result.ok) {
      if (result.error === "invalid_email") {
        return { http_status: 400, body: { error: "invalid_email" } };
      }
      if (result.error === "rate_limited") {
        return { http_status: 429, body: { error: "rate_limited" } };
      }
      return { http_status: 503, body: { error: result.error } };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "EMAIL_VERIFICATION",
        status: result.status,
        connection_id: result.connection_id,
        expires_at: result.expires_at,
        resend_after_seconds: result.resend_after_seconds,
      },
    };
  }

  if (req.action === "VERIFY_EMAIL_CODE") {
    const result = await verifyAgentEmailCode({
      connectionId: req.connection_id,
      code: req.code,
      now: deps.connectionNow,
      env: deps.env,
      sqliteDb: deps.sqliteDb,
    });
    if (!result.ok) {
      if ("error" in result) {
        return { http_status: 400, body: { error: result.error } };
      }
      return {
        http_status: 200,
        body: { agent_state: "EMAIL_VERIFICATION", status: result.status },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "EMAIL_VERIFICATION",
        status: result.status,
        connection_id: result.connection_id,
        connection_token: result.connection_token,
        credential_expires_at: result.credential_expires_at,
      },
    };
  }

  if (req.action === "REVOKE_AGENT_CONNECTION") {
    const result = await revokeAgentConnectionAction({
      connectionId: req.connection_id,
      connectionToken: req.connection_token,
      now: deps.connectionNow,
      env: deps.env,
      sqliteDb: deps.sqliteDb,
    });
    if (!result.ok) {
      return {
        http_status: 401,
        body: {
          agent_state: "AGENT_CONNECTION_REVOCATION",
          status: result.status,
        },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "AGENT_CONNECTION_REVOCATION",
        status: result.status,
        connection_id: result.connection_id,
      },
    };
  }

  if (req.action === "DISCOVER_PRODUCT") {
    const result = await discoverProductForAgent(req.purchase, {
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now: deps.connectionNow,
      offersOverride: deps.offersOverride,
    });
    if (!result.ok) {
      return {
        http_status: 400,
        body: { error: result.error, message: result.message },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "PRODUCT_DISCOVERY",
        status: result.status,
        discovery_session_id: result.discovery_session_id,
        discovery_session_expires_at: result.discovery_session_expires_at,
        candidates: result.candidates,
      },
    };
  }

  if (req.action === "CONFIRM_PRODUCT") {
    const result = await confirmProductForAgent({
      discoverySessionId: req.discovery_session_id,
      candidateId: req.candidate_id,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now: deps.connectionNow,
    });
    if (!result.ok) {
      return {
        http_status: result.http_status,
        body: { agent_state: "PRODUCT_CONFIRMATION", status: result.status },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "PRODUCT_CONFIRMATION",
        status: result.status,
        discovery_session_id: result.discovery_session_id,
        target_product_url: result.target_product_url,
        target_item_id: result.target_item_id,
        model_number: result.model_number,
        upc_or_gtin: result.upc_or_gtin,
      },
    };
  }

  if (req.action === "PREFLIGHT_MONITORING") {
    const result = await preflightMonitoringForAgent({
      connectionId: req.connection_id,
      connectionToken: req.connection_token,
      discoverySessionId: req.discovery_session_id,
      monitoringConsent: req.monitoring_consent,
      emailAlertConsent: req.email_alert_consent,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now: deps.connectionNow,
    });
    if (!result.ok && "error" in result) {
      return {
        http_status: result.http_status,
        body: { error: result.error },
      };
    }
    if (!result.ok && result.http_status === 200) {
      return {
        http_status: 200,
        body: { agent_state: "MONITORING_PREFLIGHT", status: result.status },
      };
    }
    if (!result.ok) {
      return {
        http_status: result.http_status,
        body: { agent_state: "MONITORING_PREFLIGHT", status: result.status },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "MONITORING_PREFLIGHT",
        status: result.status,
        quote_id: result.quote_id,
        price_amount: result.price_amount,
        price_currency: result.price_currency,
        quote_expires_at: result.quote_expires_at,
        monitoring_deadline: result.monitoring_deadline,
      },
    };
  }

  if (req.action === "LIST_ACTIVE_MONITORS") {
    const result = await listActiveMonitorsForAgent({
      connectionId: req.connection_id,
      connectionToken: req.connection_token,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now: deps.connectionNow,
    });
    if (!result.ok) {
      return {
        http_status: 401,
        body: {
          agent_state: "ACTIVE_MONITORS",
          status: result.status,
        },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "ACTIVE_MONITORS",
        status: "OK",
        count: result.count,
        monitors: result.monitors,
      },
    };
  }

  if (req.action === "ENABLE_EMAIL_ALERTS" || req.action === "DISABLE_EMAIL_ALERTS") {
    const result = await setEmailAlertsForAgent({
      connectionId: req.connection_id,
      connectionToken: req.connection_token,
      purchaseId: req.purchase_id,
      enabled: req.action === "ENABLE_EMAIL_ALERTS",
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now: deps.connectionNow,
    });
    if (!result.ok) {
      if ("status" in result && result.status === "ACTION_NOT_AUTHORIZED") {
        return {
          http_status: 401,
          body: {
            agent_state: "EMAIL_ALERT_PREFERENCE",
            status: "ACTION_NOT_AUTHORIZED",
          },
        };
      }
      return {
        http_status: 404,
        body: {
          error: "not_found",
          message: "No purchase found for that id.",
        },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "EMAIL_ALERT_PREFERENCE",
        status: result.status,
        purchase_id: result.purchase_id,
        email_alerts_enabled: result.email_alerts_enabled,
      },
    };
  }

  if (req.action === "STOP_MONITORING") {
    const result = await stopMonitoringForAgent({
      connectionId: req.connection_id,
      connectionToken: req.connection_token,
      purchaseId: req.purchase_id,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now: deps.connectionNow,
    });
    if (!result.ok) {
      if ("status" in result && result.status === "ACTION_NOT_AUTHORIZED") {
        return {
          http_status: 401,
          body: {
            agent_state: "MONITORING_STOP",
            status: "ACTION_NOT_AUTHORIZED",
          },
        };
      }
      return {
        http_status: 404,
        body: {
          error: "not_found",
          message: "No purchase found for that id.",
        },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "MONITORING_STOP",
        status: result.status,
        purchase_id: result.purchase_id,
        monitoring_stopped_at: result.monitoring_stopped_at,
        monitoring_stop_reason: result.monitoring_stop_reason,
        message:
          "Monitoring stopped for this purchase. Purchase history remains available.",
      },
    };
  }

  if (req.action === "REDEEM_MONITORING_PASS") {
    const result = await redeemMonitoringPassForAgent({
      monitoringPassId: req.monitoring_pass_id,
      monitoringPassToken: req.monitoring_pass_token,
      quoteId: req.quote_id,
      connectionId: req.connection_id,
      connectionToken: req.connection_token,
      sqliteDb: deps.sqliteDb,
      env: deps.env,
      now: deps.connectionNow,
    });
    if (!result.ok) {
      return {
        http_status: result.http_status,
        body: {
          agent_state: "MONITORING_PASS_REDEMPTION",
          status: result.status,
          // Reason-agnostic: never reveals which specific gate failed.
          message:
            "This Monitoring Pass could not be redeemed right now. The pass must be unused, and the purchase must still be confirmed, eligible, consented and payment-ready under a current quote from this connection.",
          next_action:
            "Re-run PREFLIGHT_MONITORING for a fresh quote_id, then retry REDEEM_MONITORING_PASS with the same pass. An unredeemed pass is not consumed by a failed attempt.",
          documentation: "https://www.usenobu.xyz/okx",
        },
      };
    }
    return {
      http_status: 200,
      body: {
        agent_state: "MONITORING_PASS_REDEMPTION",
        status: result.status,
        monitor_id: result.monitor_id,
        ...("monitoring_deadline" in result
          ? { monitoring_deadline: result.monitoring_deadline }
          : {}),
        message:
          result.status === "ACTIVATION_PENDING"
            ? "Payment and pass are recorded. Activation is completing; no further payment is required."
            : "Monitoring is active for this purchase. Nobu will alert you if a safely matched lower price appears.",
      },
    };
  }

  // CHECK_MONITORING_STATUS — ownership-safe (Lane 7.4E)
  await prepareWebDatabase();
  const statusResult = await checkMonitoringStatusForAgent({
    purchaseId: req.purchase_id,
    connectionId: "connection_id" in req ? req.connection_id : undefined,
    connectionToken: "connection_token" in req ? req.connection_token : undefined,
    sqliteDb: deps.sqliteDb,
    env: deps.env,
    now: deps.connectionNow,
  });
  if (!statusResult.ok) {
    if (statusResult.http_status === 401) {
      return {
        http_status: 401,
        body: {
          agent_state: "MONITORING_STATUS",
          status: "ACTION_NOT_AUTHORIZED",
        },
      };
    }
    return {
      http_status: 404,
      body: {
        error: statusResult.error,
        message: statusResult.message,
      },
    };
  }
  return { http_status: 200, body: statusResult.body };
}
