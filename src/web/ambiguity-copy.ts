/**
 * Short user-facing copy for enrollment ambiguity / weak match.
 * Never asks the user to re-enter identifiers already on the purchase.
 */

export interface AmbiguityCopyInput {
  reasons: string[];
  has_tcin?: boolean;
  has_model?: boolean;
  has_upc?: boolean;
  has_target_url?: boolean;
  candidate_count?: number;
}

export interface AmbiguityCopy {
  heading: string;
  body: string;
  nextAction: string;
}

/**
 * Choose copy from match reasons + what identifiers the user already supplied.
 */
export function enrollmentAmbiguityCopy(input: AmbiguityCopyInput): AmbiguityCopy {
  const reasons = input.reasons ?? [];
  const multi =
    reasons.includes("ambiguous_multiple_strong_target_candidates") ||
    (input.candidate_count != null && input.candidate_count > 1);

  if (multi) {
    return {
      heading: "We need a little more detail",
      body: "Nobu found several different Target products and could not safely choose one.",
      nextAction: "Edit the product link or identifiers and try again.",
    };
  }

  if (reasons.includes("title_only_insufficient")) {
    if (!input.has_model) {
      return {
        heading: "Model number needed",
        body: "Nobu found a likely Target result, but title similarity alone is not safe enough to confirm.",
        nextAction: "Add the model number from your order or package, then try again.",
      };
    }
    if (!input.has_upc) {
      return {
        heading: "UPC needed",
        body: "Nobu found a likely Target result, but it still needs barcode identity to avoid the wrong item.",
        nextAction: "Add the UPC or GTIN from your order or package, then try again.",
      };
    }
  }

  // Has strong ids already but still no safe match
  const hasStrongId =
    Boolean(input.has_tcin) ||
    Boolean(input.has_model) ||
    Boolean(input.has_upc) ||
    Boolean(input.has_target_url);

  if (hasStrongId) {
    return {
      heading: "We need a little more detail",
      body: "Nobu found Target evidence, but it was not strong enough to lock one exact item.",
      nextAction: input.has_model
        ? "Add the UPC or GTIN if you have it, then try again."
        : "Add the model number if you have it, then try again.",
    };
  }

  // Genuinely missing identifiers — only mention ones not already present
  const need: string[] = [];
  if (!input.has_model) need.push("model");
  if (!input.has_tcin) need.push("TCIN");
  if (!input.has_upc) need.push("UPC");

  if (need.length === 0) {
    return {
      heading: "We need a little more detail",
      body: "Nobu found several different Target products and could not safely choose one.",
      nextAction: "Edit the product link or identifiers and try again.",
    };
  }

  let list: string;
  if (need.length === 1) list = need[0]!;
  else if (need.length === 2) list = `${need[0]} or ${need[1]}`;
  else list = `${need[0]}, ${need[1]} or ${need[2]}`;

  return {
    heading: "We need a little more detail",
    body: `Add a ${list} to narrow the match.`,
    nextAction: "Edit purchase details and try again.",
  };
}
