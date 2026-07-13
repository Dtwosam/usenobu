/**
 * Plain-language user errors for consumer screens.
 * Never surface raw Zod or stack traces as primary copy.
 */

export type UserError = {
  heading: string;
  body: string;
  nextAction: string;
  code: string;
};

export function purchaseFormError(
  code: string,
  status?: string,
): UserError {
  if (code === "invalid_input") {
    return {
      code,
      heading: "Check your purchase details",
      body: "Something in the form needs a quick fix — like the price, date, or product link.",
      nextAction: "Review the highlighted fields and try again. Your answers are still here.",
    };
  }

  if (code === "unsupported_or_ineligible") {
    if (status === "WINDOW_EXPIRED") {
      return {
        code,
        heading: "Monitoring window ended",
        body: "Target’s usual adjustment window for this purchase appears closed.",
        nextAction: "If you still have questions, contact Target Guest Services with your receipt.",
      };
    }
    return {
      code,
      heading: "This purchase isn’t supported",
      body:
        status === "POLICY_EXCLUSION"
          ? "Nobu can only watch eligible Target.com purchases sold by Target in supported U.S. locations."
          : "Nobu can only watch Target.com / Target app purchases sold by Target in the contiguous U.S. (Alaska and Hawaii are unsupported). Target Plus is not supported.",
      nextAction: "Use a different eligible purchase, or read how Nobu works for the full list.",
    };
  }

  return {
    code,
    heading: "Something went wrong",
    body: "We couldn’t start watching this purchase.",
    nextAction: "Try again in a moment. If it keeps happening, check your details and the notices page.",
  };
}

export function reviewError(code: string): UserError {
  switch (code) {
    case "cannot_confirm_weak_or_ambiguous":
      return {
        code,
        heading: "We need a little more detail",
        body: "This match isn’t strong enough to lock yet.",
        nextAction: "Add a model, TCIN, or UPC and try again so Nobu doesn’t pick the wrong item.",
      };
    case "already_confirmed":
      return {
        code,
        heading: "Product already confirmed",
        body: "This purchase is already locked and being watched.",
        nextAction: "Open the purchase dashboard to check the latest price.",
      };
    default:
      return {
        code,
        heading: "Couldn’t confirm this product",
        body: "Confirmation was blocked so we don’t watch the wrong item.",
        nextAction: "Go back, adjust product details, and try again.",
      };
  }
}

export function dashboardError(code: string): UserError {
  switch (code) {
    case "not_confirmed":
      return {
        code,
        heading: "Confirm your product first",
        body: "Price checks start only after you lock the exact Target item.",
        nextAction: "Open candidate review and confirm the match.",
      };
    case "not_found":
      return {
        code,
        heading: "Purchase not found",
        body: "We couldn’t find that purchase.",
        nextAction: "Return to your purchases list and pick one that is still listed.",
      };
    default:
      return {
        code,
        heading: "Price check didn’t finish",
        body: "Something went wrong while checking for a lower price.",
        nextAction: "Try the check again. If it keeps failing, wait a few minutes.",
      };
  }
}
