"use server";

import { understandPurchase } from "../ai/understand-purchase.js";
import type { UnderstandPurchaseResponse } from "../ai/schemas.js";

export type AiFillResult =
  | { ok: true; data: UnderstandPurchaseResponse }
  | { ok: false; error: string; message: string };

/**
 * Server action for "Fill details with AI".
 * Never logs or returns raw purchase_text beyond the request.
 * Never starts matching/monitoring.
 */
export async function fillDetailsWithAiAction(
  purchaseText: string,
): Promise<AiFillResult> {
  try {
    const result = await understandPurchase(purchaseText);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        message: result.message,
      };
    }
    return { ok: true, data: result.body };
  } catch (err) {
    console.error("fillDetailsWithAiAction_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: "ai_unavailable",
      message:
        "AI assistance is temporarily unavailable. You can still enter the purchase details manually.",
    };
  }
}
