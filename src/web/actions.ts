"use server";

import { redirect } from "next/navigation";
import {
  confirmPurchaseCandidate,
  createPurchaseFlow,
  runDemoPriceCheck,
} from "./purchase-service.js";
import { getWebDatabase } from "./db.js";
import {
  hydrateDatabaseFromCookie,
  persistDatabaseToCookie,
} from "./session-snapshot.js";

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

/** Preserve user-entered values on validation/policy failure (no secrets collected). */
function purchaseErrorRedirect(formData: FormData, error: string, status = "") {
  const q = new URLSearchParams({
    error,
    status,
    target_product_url: formString(formData, "target_product_url"),
    purchase_price: formString(formData, "purchase_price"),
    purchase_date: formString(formData, "purchase_date"),
    region: formString(formData, "region"),
    model_number: formString(formData, "model_number"),
    target_item_id: formString(formData, "target_item_id"),
    upc_or_gtin: formString(formData, "upc_or_gtin"),
    product_title: formString(formData, "product_title"),
    fixture_scenario: formString(formData, "fixture_scenario") || "exact_match",
  });
  redirect(`/purchases/new?${q.toString()}`);
}

export async function submitPurchaseAction(formData: FormData) {
  try {
    const db = getWebDatabase();
    await hydrateDatabaseFromCookie(db);

    const result = createPurchaseFlow({
      target_product_url: formString(formData, "target_product_url"),
      purchase_price: formString(formData, "purchase_price"),
      purchase_date: formString(formData, "purchase_date"),
      region: formString(formData, "region") || undefined,
      model_number: formString(formData, "model_number") || undefined,
      target_item_id: formString(formData, "target_item_id") || undefined,
      upc_or_gtin: formString(formData, "upc_or_gtin") || undefined,
      product_title: formString(formData, "product_title") || undefined,
      fixture_scenario: (formString(formData, "fixture_scenario") ||
        "exact_match") as
        | "exact_match"
        | "ambiguous"
        | "no_price"
        | "unsupported",
    });

    if (!result.ok) {
      const status =
        "policy" in result && result.policy ? result.policy.status : "";
      purchaseErrorRedirect(formData, result.error, status);
    }

    await persistDatabaseToCookie(db);

    redirect(
      `/purchases/${result.purchase_id}/review?scenario=${encodeURIComponent(
        formString(formData, "fixture_scenario") || "exact_match",
      )}&title=${encodeURIComponent(formString(formData, "product_title"))}`,
    );
  } catch (err) {
    // Next.js redirect() throws a special error — rethrow it
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    console.error("submitPurchaseAction_failed", {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    purchaseErrorRedirect(formData, "server_error");
  }
}

export async function confirmCandidateAction(formData: FormData) {
  const purchaseId = formString(formData, "purchase_id");
  try {
    const db = getWebDatabase();
    await hydrateDatabaseFromCookie(db);

    const candidateJson = formString(formData, "candidate_json");
    const result = confirmPurchaseCandidate({
      purchase_id: purchaseId,
      candidate_json: candidateJson,
    });
    if (!result.ok) {
      redirect(
        `/purchases/${purchaseId}/review?error=${encodeURIComponent(result.error)}`,
      );
    }
    await persistDatabaseToCookie(db);
    redirect(`/purchases/${purchaseId}`);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    console.error("confirmCandidateAction_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    redirect(
      `/purchases/${purchaseId}/review?error=${encodeURIComponent("server_error")}`,
    );
  }
}

export async function runCheckAction(formData: FormData) {
  const purchaseId = formString(formData, "purchase_id");
  try {
    const db = getWebDatabase();
    await hydrateDatabaseFromCookie(db);

    const result = await runDemoPriceCheck(purchaseId);
    if (!result.ok) {
      redirect(
        `/purchases/${purchaseId}?error=${encodeURIComponent(result.error)}`,
      );
    }
    await persistDatabaseToCookie(db);
    const alertId = result.batch.results[0]?.alert_id;
    if (alertId && result.batch.alerts_created > 0) {
      redirect(`/purchases/${purchaseId}/alerts/${alertId}`);
    }
    redirect(`/purchases/${purchaseId}?checked=1`);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    console.error("runCheckAction_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    redirect(
      `/purchases/${purchaseId}?error=${encodeURIComponent("server_error")}`,
    );
  }
}
