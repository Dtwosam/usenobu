"use server";

import { redirect } from "next/navigation";
import {
  confirmPurchaseCandidate,
  createPurchaseFlow,
  runDemoPriceCheck,
} from "./purchase-service.js";

export async function submitPurchaseAction(formData: FormData) {
  const result = createPurchaseFlow({
    target_product_url: String(formData.get("target_product_url") ?? ""),
    purchase_price: String(formData.get("purchase_price") ?? ""),
    purchase_date: String(formData.get("purchase_date") ?? ""),
    region: String(formData.get("region") ?? "") || undefined,
    model_number: String(formData.get("model_number") ?? "") || undefined,
    target_item_id: String(formData.get("target_item_id") ?? "") || undefined,
    upc_or_gtin: String(formData.get("upc_or_gtin") ?? "") || undefined,
    product_title: String(formData.get("product_title") ?? "") || undefined,
    fixture_scenario: (String(formData.get("fixture_scenario") ?? "exact_match") ||
      "exact_match") as "exact_match" | "ambiguous" | "no_price" | "unsupported",
  });

  if (!result.ok) {
    const q = new URLSearchParams({
      error: result.error,
      status: "policy" in result && result.policy ? result.policy.status : "",
    });
    redirect(`/purchases/new?${q.toString()}`);
  }

  // Stash evaluation in query via session-less cookie is hard; re-evaluate on review page from DB + scenario
  // Pass scenario for review page reconstruction
  redirect(
    `/purchases/${result.purchase_id}/review?scenario=${encodeURIComponent(
      String(formData.get("fixture_scenario") ?? "exact_match"),
    )}&title=${encodeURIComponent(String(formData.get("product_title") ?? ""))}`,
  );
}

export async function confirmCandidateAction(formData: FormData) {
  const purchaseId = String(formData.get("purchase_id") ?? "");
  const candidateJson = String(formData.get("candidate_json") ?? "");
  const result = confirmPurchaseCandidate({
    purchase_id: purchaseId,
    candidate_json: candidateJson,
  });
  if (!result.ok) {
    redirect(
      `/purchases/${purchaseId}/review?error=${encodeURIComponent(result.error)}`,
    );
  }
  redirect(`/purchases/${purchaseId}`);
}

export async function runCheckAction(formData: FormData) {
  const purchaseId = String(formData.get("purchase_id") ?? "");
  const result = await runDemoPriceCheck(purchaseId);
  if (!result.ok) {
    redirect(
      `/purchases/${purchaseId}?error=${encodeURIComponent(result.error)}`,
    );
  }
  const alertId = result.batch.results[0]?.alert_id;
  if (alertId && result.batch.alerts_created > 0) {
    redirect(`/purchases/${purchaseId}/alerts/${alertId}`);
  }
  redirect(`/purchases/${purchaseId}?checked=1`);
}
