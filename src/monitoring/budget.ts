import type { SearchBudgetSnapshot } from "./types.js";

/** Default Free-plan SerpApi monthly search budget (data contract). */
export const DEFAULT_MONTHLY_SEARCH_LIMIT = 250;

/** UTC calendar month key YYYY-MM for budget periods. */
export function budgetPeriodKey(asOfIso: string): string {
  const d = new Date(asOfIso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid as_of for budget period: ${asOfIso}`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function snapshotBudget(args: {
  period_key: string;
  limit: number;
  used: number;
}): SearchBudgetSnapshot {
  const used = Math.max(0, Math.floor(args.used));
  const limit = Math.max(0, Math.floor(args.limit));
  return {
    period_key: args.period_key,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

/** Deterministic guard: never silently overspend. */
export function canConsumeSearches(
  budget: SearchBudgetSnapshot,
  count = 1,
): boolean {
  if (count <= 0) return true;
  return budget.remaining >= count;
}

export function consumeSearches(
  budget: SearchBudgetSnapshot,
  count = 1,
): SearchBudgetSnapshot {
  if (!canConsumeSearches(budget, count)) {
    throw new Error(
      `Search budget exhausted for ${budget.period_key}: used=${budget.used} limit=${budget.limit}`,
    );
  }
  return snapshotBudget({
    period_key: budget.period_key,
    limit: budget.limit,
    used: budget.used + count,
  });
}
