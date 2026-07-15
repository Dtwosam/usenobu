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

  // Empty defaults — never seed demo Example Widget IDs into production discovery.
  // Error redirects may repopulate from query params via val().
  const defaults = {
    url: val(sp, "target_product_url", ""),
    price: val(sp, "purchase_price", ""),
    date: val(sp, "purchase_date", ""),
    region: val(sp, "region", ""),
    tcin: val(sp, "target_item_id", ""),
    model: val(sp, "model_number", ""),
    title: val(sp, "product_title", ""),
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
