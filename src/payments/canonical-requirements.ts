/**
 * Canonical PaymentRequirements for Monitoring Pass.
 *
 * One fully enhanced object is used for BOTH the PAYMENT-REQUIRED challenge
 * accepts[] entry AND facilitator verify/settle. Never mutate extras between
 * challenge and replay (no /supported-only enrichment on replay).
 *
 * Official shape (PaymentRequirements from @okxweb3/x402-core):
 *   { scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra }
 * Resource is top-level on PaymentRequired, not on each accept.
 *
 * EIP-712 domain metadata comes from ExactEvmScheme / getDefaultAsset for
 * eip155:196 (name USD₮0, version "1", decimals 6) — not a manual flat override
 * that diverges from the installed package.
 */
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import {
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_MAX_TIMEOUT_SECONDS,
  X402_VERSION,
} from "./x402.js";
import { loadOkxSellerConfig } from "./okx-seller-client.js";

export type CanonicalPaymentRequirements = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

export type CanonicalPaymentRequired = {
  x402Version: number;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: CanonicalPaymentRequirements[];
};

const schemeServer = new ExactEvmScheme();

/**
 * Build the single canonical requirements object.
 * Uses ExactEvmScheme.parsePrice → defaultMoneyConversion for official extra
 * (name/version from package getDefaultAsset for eip155:196).
 */
export async function buildCanonicalPaymentRequirements(args: {
  payTo: string;
  /** Optional quote binding for enrollment-bound challenges only. */
  quoteId?: string;
}): Promise<CanonicalPaymentRequirements> {
  // Drive through official ExactEvmScheme so extra matches the package wire form.
  // Pass locked AssetAmount so amount/asset stay fixed; scheme still fills extra.
  const parsed = await schemeServer.parsePrice(
    {
      amount: MONITORING_PRICE_ATOMIC_UNITS,
      asset: DEFAULT_SETTLEMENT_ASSET,
      // Let scheme defaults fill domain when empty; then we merge locked defaults.
      extra: {},
    },
    DEFAULT_SETTLEMENT_NETWORK,
  );

  // Official defaultMoneyConversion path for network (authoritative name/version).
  const fromNetwork = await schemeServer.parsePrice(
    0.99,
    DEFAULT_SETTLEMENT_NETWORK,
  );

  const baseExtra: Record<string, unknown> = {
    ...(fromNetwork.extra && typeof fromNetwork.extra === "object"
      ? fromNetwork.extra
      : {}),
    ...(parsed.extra && typeof parsed.extra === "object" ? parsed.extra : {}),
  };

  // Locked amount/asset always win; extra domain from official scheme.
  let requirements: CanonicalPaymentRequirements = {
    scheme: "exact",
    network: DEFAULT_SETTLEMENT_NETWORK,
    asset: DEFAULT_SETTLEMENT_ASSET,
    amount: MONITORING_PRICE_ATOMIC_UNITS,
    payTo: args.payTo,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    extra: baseExtra,
  };

  // enhancePaymentRequirements is identity for ExactEvmScheme but keeps us on
  // the official server path if the package later enriches.
  const enhanced = await schemeServer.enhancePaymentRequirements(
    {
      ...requirements,
      network: DEFAULT_SETTLEMENT_NETWORK as `${string}:${string}`,
    },
    {
      x402Version: X402_VERSION,
      scheme: "exact",
      network: DEFAULT_SETTLEMENT_NETWORK as `${string}:${string}`,
      extra: fromNetwork.extra,
    },
    [],
  );

  requirements = {
    scheme: "exact",
    network: String(enhanced.network),
    asset: String(enhanced.asset),
    amount: String(enhanced.amount),
    payTo: String(enhanced.payTo ?? args.payTo),
    maxTimeoutSeconds: Number(
      enhanced.maxTimeoutSeconds ?? X402_MAX_TIMEOUT_SECONDS,
    ),
    extra:
      enhanced.extra && typeof enhanced.extra === "object"
        ? { ...(enhanced.extra as Record<string, unknown>) }
        : { ...baseExtra },
  };

  // Force locked commercial terms after enhance (never trust enhancer for amount).
  requirements.scheme = "exact";
  requirements.network = DEFAULT_SETTLEMENT_NETWORK;
  requirements.asset = DEFAULT_SETTLEMENT_ASSET;
  requirements.amount = MONITORING_PRICE_ATOMIC_UNITS;
  requirements.payTo = args.payTo;
  requirements.maxTimeoutSeconds = X402_MAX_TIMEOUT_SECONDS;

  if (args.quoteId) {
    requirements.extra = { ...requirements.extra, quote_id: args.quoteId };
  }

  return requirements;
}

/**
 * Build PaymentRequired challenge body using the same accepts[0] object that
 * will be sent to verify/settle.
 */
export async function buildCanonicalPaymentRequired(args: {
  resourceUrl: string;
  description: string;
  payTo: string;
  quoteId?: string;
}): Promise<{
  paymentRequired: CanonicalPaymentRequired;
  requirements: CanonicalPaymentRequirements;
}> {
  const requirements = await buildCanonicalPaymentRequirements({
    payTo: args.payTo,
    quoteId: args.quoteId,
  });
  const paymentRequired: CanonicalPaymentRequired = {
    x402Version: X402_VERSION,
    resource: {
      url: args.resourceUrl,
      description: args.description,
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
  return { paymentRequired, requirements };
}

/** Deep structural equality for requirements (sorted JSON). */
export function paymentRequirementsDeepEqual(
  a: CanonicalPaymentRequirements | Record<string, unknown>,
  b: CanonicalPaymentRequirements | Record<string, unknown>,
): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function resolvePayTo(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  override?: string | null,
): string | null {
  if (override !== undefined && override !== null) {
    return override;
  }
  return loadOkxSellerConfig(env)?.payTo ?? null;
}
