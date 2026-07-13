import { purchaseFormError } from "@/web/error-copy";
import { PurchaseIntake, PurchasePageChrome } from "./PurchaseIntake";

function val(
  sp: Record<string, string | undefined>,
  key: string,
  fallback = "",
): string {
  return sp[key] ?? fallback;
}

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const errorCode = sp.error;
  const userError = errorCode
    ? purchaseFormError(errorCode, sp.status)
    : null;
  const focusRegion = errorCode === "unsupported_or_ineligible";

  const defaults = {
    url: val(
      sp,
      "target_product_url",
      "https://www.target.com/p/example-widget/-/A-87654321",
    ),
    price: val(sp, "purchase_price", "24.99"),
    date: val(sp, "purchase_date", "2026-07-05"),
    region: val(sp, "region", "TX"),
    tcin: val(sp, "target_item_id", "87654321"),
    model: val(sp, "model_number", "WDG-100"),
    title: val(sp, "product_title", "Example Widget Blue"),
    upc: val(sp, "upc_or_gtin", ""),
    scenario: val(sp, "fixture_scenario", "exact_match"),
  };

  return (
    <PurchasePageChrome
      serverError={
        userError
          ? {
              heading: userError.heading,
              body: userError.body,
              nextAction: userError.nextAction,
              code: userError.code,
            }
          : null
      }
    >
      <PurchaseIntake
        defaults={defaults}
        focusRegion={focusRegion}
        serverError={
          userError
            ? {
                heading: userError.heading,
                body: userError.body,
                nextAction: userError.nextAction,
                code: userError.code,
              }
            : null
        }
      />
    </PurchasePageChrome>
  );
}
