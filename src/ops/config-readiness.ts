/**
 * Owner-only configuration readiness: booleans only, never secret material.
 */
import { hasDurableDatabaseUrl } from "../auth/auth-store.js";
import { isEmailDeliveryConfigured } from "../auth/config.js";
import { loadOkxSellerConfig } from "../payments/okx-seller-client.js";
import { isPassClaimSecretConfigured } from "../payments/claim-credential.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type ConfigReadiness = {
  durable_database_configured: boolean;
  okx_seller_configured: boolean;
  nobu_pass_claim_secret_configured: boolean;
  email_provider_configured: boolean;
  owner_ops_secret_configured: boolean;
  cron_secret_configured: boolean;
};

export function getConfigReadiness(
  env: EnvRecord = process.env,
): ConfigReadiness {
  return {
    durable_database_configured: hasDurableDatabaseUrl(env),
    okx_seller_configured: loadOkxSellerConfig(env) !== null,
    nobu_pass_claim_secret_configured: isPassClaimSecretConfigured(env),
    email_provider_configured: isEmailDeliveryConfigured(env),
    owner_ops_secret_configured: Boolean(
      String(env.OWNER_OPS_SECRET || "").trim(),
    ),
    cron_secret_configured: Boolean(String(env.CRON_SECRET || "").trim()),
  };
}
