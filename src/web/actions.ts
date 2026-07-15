"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  confirmPurchaseCandidate,
  createPurchaseFlow,
} from "./purchase-service.js";
import { getWebDatabase, markCookieHydrated } from "./db.js";
import {
  hydrateDatabaseFromCookie,
  persistDatabaseToCookie,
} from "./session-snapshot.js";
import {
  runBoundedManualCheck,
  WEB_DEMO_USER_REF,
} from "./manual-check.js";
import {
  buildReviewRedirectPath,
  isValidPurchaseId,
} from "./navigation.js";

/** Cookie is source of truth on Vercel — re-hydrate each mutation request. */
async function prepareActionDb() {
  const db = getWebDatabase();
  markCookieHydrated(false);
  await hydrateDatabaseFromCookie(db);
  return db;
}

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

/** Next.js redirect() throws; always rethrow so navigation is not swallowed. */
function rethrowIfNavigation(err: unknown): void {
  if (isRedirectError(err)) throw err;
  if (
    err &&
    typeof err === "object" &&
    "digest" in err &&
    String((err as { digest?: string }).digest).includes("NEXT_REDIRECT")
  ) {
    throw err;
  }
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
    const db = await prepareActionDb();

    const result = await createPurchaseFlow({
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
      return;
    }

    // No live Target candidates → stay on form (do not redirect to empty/invalid review)
    const candidateCount = result.evaluation?.candidates?.length ?? 0;
    if (
      result.data_source === "LIVE" &&
      candidateCount === 0
    ) {
      purchaseErrorRedirect(formData, "no_reliable_target");
      return;
    }

    if (!isValidPurchaseId(result.purchase_id)) {
      purchaseErrorRedirect(
        formData,
        "save_failed",
        `bad_id:${String(result.purchase_id ?? "").slice(0, 24)}`,
      );
      return;
    }

    const persisted = await persistDatabaseToCookie(db);
    // On multi-instance hosts the cookie is the only shared session store.
    // Never redirect to review without a successful session write.
    if (!persisted.ok) {
      console.error("submitPurchaseAction_persist_failed", persisted);
      purchaseErrorRedirect(
        formData,
        "save_failed",
        persisted.reason ?? "persist_failed",
      );
      return;
    }

    const qs = new URLSearchParams();
    qs.set("title", formString(formData, "product_title"));
    qs.set("source", result.data_source ?? "LIVE");
    if (result.data_source === "FIXTURE") {
      qs.set(
        "scenario",
        formString(formData, "fixture_scenario") || "exact_match",
      );
    }
    const target = buildReviewRedirectPath(result.purchase_id, qs);
    if (!target) {
      purchaseErrorRedirect(formData, "save_failed", "bad_redirect_path");
      return;
    }
    redirect(target);
  } catch (err) {
    rethrowIfNavigation(err);
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
    const db = await prepareActionDb();

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
    rethrowIfNavigation(err);
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
    const db = await prepareActionDb();

    // Production: prefer_fixture omitted → LIVE SerpApi (fixture only if gate open, e.g. e2e).
    const result = await runBoundedManualCheck({
      db,
      purchase_id: purchaseId,
      user_ref: WEB_DEMO_USER_REF,
    });
    if (!result.ok) {
      const ds = result.data_source ?? "";
      redirect(
        `/purchases/${purchaseId}?error=${encodeURIComponent(result.error)}&outcome=${encodeURIComponent(result.outcome)}${ds ? `&data_source=${encodeURIComponent(ds)}` : ""}`,
      );
    }
    await persistDatabaseToCookie(db);
    const alertId = result.alert_id;
    const outcome = result.outcome;
    const dataSource = result.data_source;
    if (alertId && result.batch.alerts_created > 0) {
      redirect(
        `/purchases/${purchaseId}/alerts/${alertId}?outcome=${encodeURIComponent(outcome)}&data_source=${encodeURIComponent(dataSource)}`,
      );
    }
    redirect(
      `/purchases/${purchaseId}?checked=1&outcome=${encodeURIComponent(outcome)}&data_source=${encodeURIComponent(dataSource)}`,
    );
  } catch (err) {
    rethrowIfNavigation(err);
    console.error("runCheckAction_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    redirect(
      `/purchases/${purchaseId}?error=${encodeURIComponent("server_error")}`,
    );
  }
}
