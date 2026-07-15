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
      heading: "This retailer isn’t supported yet",
      body:
        status === "POLICY_EXCLUSION"
          ? "Nobu currently supports eligible Target.com purchases sold by Target in supported U.S. locations."
          : "Nobu currently supports eligible Target.com purchases. Alaska and Hawaii are unsupported for this Target integration. Target Plus is not supported.",
      nextAction: "Track a Target purchase that meets the supported rules, or read how Nobu works.",
    };
  }

  if (code === "server_error") {
    return {
      code,
      heading: "We couldn’t finish that search",
      body: "Something went wrong on our side while looking up your product. Your answers are still here.",
      nextAction: "Try Find my product again. If it keeps failing, wait a minute and retry.",
    };
  }

  if (code === "save_failed") {
    return {
      code,
      heading: "Couldn’t save this purchase",
      body: "Nobu could not save this purchase. Please try again.",
      nextAction: "Your details are still here — try Find my product again.",
    };
  }

  if (code === "no_reliable_target") {
    return {
      code,
      heading: "No reliable Target product",
      body: "Nobu could not find a reliable Target product right now.",
      nextAction: "Check the product link, model, or TCIN and try again.",
    };
  }

  if (code === "session_lost") {
    return {
      code,
      heading: "Session expired",
      body: "Nobu could not save this purchase. Please try again.",
      nextAction: "Enter your purchase details again and click Find my product.",
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
    case "server_error":
      return {
        code,
        heading: "We couldn’t confirm just now",
        body: "Something went wrong on our side. Your product choices are still available to retry.",
        nextAction: "Try confirming again. If it keeps failing, go back and search again.",
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
        heading: "Confirm first",
        body: "Checks start only after you lock the exact product.",
        nextAction: "Confirm the product on the review screen.",
      };
    case "not_found":
      return {
        code,
        heading: "Purchase not found",
        body: "We couldn’t find that purchase.",
        nextAction: "Return to your purchases list.",
      };
    case "cooldown":
    case "busy":
      return {
        code,
        heading: "Please wait",
        body: "Please wait before checking again.",
        nextAction: "Try again in a short moment.",
      };
    case "unauthorized":
      return {
        code,
        heading: "Not available",
        body: "You can’t check this purchase.",
        nextAction: "Open a purchase you own.",
      };
    case "budget":
      return {
        code,
        heading: "Source unavailable",
        body: "The price source is temporarily unavailable.",
        nextAction: "Try again later.",
      };
    case "server_error":
      return {
        code,
        heading: "Check didn’t finish",
        body: "Something went wrong while checking the price.",
        nextAction: "Try again in a moment.",
      };
    default:
      return {
        code,
        heading: "Check didn’t finish",
        body: "Something went wrong while checking the price.",
        nextAction: "Try again in a moment.",
      };
  }
}
