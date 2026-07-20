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
import { runBoundedManualCheck } from "./manual-check.js";
import {
  buildReviewRedirectPath,
  isValidPurchaseId,
} from "./navigation.js";
import { isFixtureCheckAllowed } from "./manual-check-mode.js";
import type { FixtureScenario } from "./fixtures.js";
import { getOrCreateSessionOwner } from "./session-owner.js";

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
  // Outdated demo drafts: clear identity fields so placeholders cannot re-submit.
  if (error === "outdated_demo_draft") {
    const q = new URLSearchParams({
      error,
      status,
      purchase_price: formString(formData, "purchase_price"),
      purchase_date: formString(formData, "purchase_date"),
      region: formString(formData, "region"),
    });
    redirect(`/purchases/new?${q.toString()}`);
  }
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
    product_description: formString(formData, "product_description"),
    brand: formString(formData, "brand"),
    color: formString(formData, "color"),
    size: formString(formData, "size"),
    quantity: formString(formData, "quantity"),
  });
  redirect(`/purchases/new?${q.toString()}`);
}

export async function submitPurchaseAction(formData: FormData) {
  try {
    const db = await prepareActionDb();
    // Server-assigned owner only — ignore any client user/owner/email fields.
    const ownerRef = await getOrCreateSessionOwner();

    // Fixture scenario is never shown in production UI. Only honor it when the
    // server fixture gate is open (tests/e2e inject a hidden field or env).
    const fixtureScenario = isFixtureCheckAllowed()
      ? ((formString(formData, "fixture_scenario") ||
          undefined) as FixtureScenario | undefined)
      : undefined;

    const result = await createPurchaseFlow(
      {
        target_product_url: formString(formData, "target_product_url") || undefined,
        purchase_price: formString(formData, "purchase_price"),
        purchase_date: formString(formData, "purchase_date"),
        region: formString(formData, "region") || undefined,
        model_number: formString(formData, "model_number") || undefined,
        target_item_id: formString(formData, "target_item_id") || undefined,
        upc_or_gtin: formString(formData, "upc_or_gtin") || undefined,
        product_title: formString(formData, "product_title") || undefined,
        product_description:
          formString(formData, "product_description") ||
          formString(formData, "product_title") ||
          undefined,
        brand: formString(formData, "brand") || undefined,
        color: formString(formData, "color") || undefined,
        size: formString(formData, "size") || undefined,
        quantity: formString(formData, "quantity") || undefined,
        fixture_scenario: fixtureScenario,
      },
      { owner_ref: ownerRef },
    );

    if (!result.ok) {
      // Structured diagnostics only — no secrets, no full cookies, no PII dumps.
      console.info("submitPurchaseAction_result", {
        ok: false,
        error: result.error,
        has_tcin: Boolean(formString(formData, "target_item_id")),
        has_model: Boolean(formString(formData, "model_number")),
        has_target_url: /target\.com/i.test(
          formString(formData, "target_product_url"),
        ),
        has_description: Boolean(
          formString(formData, "product_description") ||
            formString(formData, "product_title"),
        ),
      });
      const status =
        "status" in result && result.status
          ? String(result.status)
          : "policy" in result && result.policy
            ? result.policy.status
            : "";
      purchaseErrorRedirect(formData, result.error, status);
      return;
    }

    // Live zero-candidate discovery is a valid fail-closed review state:
    // preserve purchase details, show diagnostics/progressive fallback copy,
    // and do not collapse into a premature generic form error.
    const candidateCount = result.evaluation?.candidates?.length ?? 0;
    console.info("submitPurchaseAction_result", {
      ok: true,
      purchase_id: result.purchase_id,
      data_source: result.data_source,
      discovery_kind:
        "discovery_kind" in result ? result.discovery_kind : null,
      decision: result.evaluation?.decision ?? null,
      reasons: result.evaluation?.reasons?.slice(0, 4) ?? [],
      candidate_count: candidateCount,
      has_tcin: Boolean(formString(formData, "target_item_id")),
      has_model: Boolean(formString(formData, "model_number")),
      has_target_url: /target\.com/i.test(
        formString(formData, "target_product_url"),
      ),
      title_len: formString(formData, "product_title").length,
    });
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
    qs.set(
      "title",
      formString(formData, "product_title") ||
        formString(formData, "product_description"),
    );
    qs.set("source", result.data_source ?? "LIVE");
    if ("discovery_kind" in result && result.discovery_kind) {
      qs.set("discovery_kind", String(result.discovery_kind));
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
    const ownerRef = await getOrCreateSessionOwner();

    const candidateId = formString(formData, "candidate_id");
    const result = confirmPurchaseCandidate({
      purchase_id: purchaseId,
      candidate_id: candidateId,
      owner_ref: ownerRef,
    });
    if (!result.ok) {
      // Cross-user / missing → generic not found (do not leak existence).
      if (result.error === "not_found") {
        redirect(`/dashboard?error=${encodeURIComponent("not_found")}`);
      }
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
    const ownerRef = await getOrCreateSessionOwner();

    // Production: prefer_fixture omitted → LIVE SerpApi (fixture only if gate open, e.g. e2e).
    const result = await runBoundedManualCheck({
      db,
      purchase_id: purchaseId,
      user_ref: ownerRef,
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
