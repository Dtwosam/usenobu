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
import { getPurchaseDetail } from "../web/purchase-service.js";

export type AgentServiceDeps = UnderstandDeps & A2mcpCheckDeps;

export type AgentServiceResult =
  | {
      http_status: 200;
      body: UnderstandPurchaseResponse | Record<string, unknown>;
    }
  | {
      http_status: 400 | 404 | 503;
      body: { error: string; message?: string; details?: unknown };
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

  // CHECK_MONITORING_STATUS
  await prepareWebDatabase();
  const detail = getPurchaseDetail(req.purchase_id);
  if (!detail) {
    return {
      http_status: 404,
      body: {
        error: "not_found",
        message: "No purchase found for that id.",
      },
    };
  }

  const { purchase, fingerprint, observations, alerts, runs } = detail;
  return {
    http_status: 200,
    body: {
      agent_state: "MONITORING_STATUS",
      purchase_id: String(purchase.id),
      status: String(purchase.status),
      retailer: "Target",
      purchase_price: Number(purchase.purchase_price),
      currency: String(purchase.currency),
      purchase_date: String(purchase.purchase_date),
      monitoring_deadline: purchase.monitoring_deadline
        ? String(purchase.monitoring_deadline)
        : null,
      has_locked_fingerprint: Boolean(fingerprint),
      latest_observed_price:
        observations[0]?.observed_price != null
          ? Number(observations[0].observed_price)
          : null,
      alert_count: alerts.length,
      run_count: runs.length,
      message:
        String(purchase.status) === "MONITORING_ACTIVE"
          ? "Nobu is watching this purchase"
          : `Current status: ${String(purchase.status)}`,
    },
  };
}
