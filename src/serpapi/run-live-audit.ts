/**
 * Bounded live SerpApi capability audit CLI.
 * Usage: npx tsx src/serpapi/run-live-audit.ts
 * Requires SERPAPI_API_KEY. Does not print the key.
 */
import {
  createSerpApiClientFromEnv,
  runBoundedLiveCapabilityAudit,
} from "./index.js";

async function main(): Promise<void> {
  const client = createSerpApiClientFromEnv();
  if (!client) {
    console.error(
      "NOBU_LANE_3_BLOCKED: SERPAPI_API_KEY is not set. Offline connector tests may still pass.",
    );
    process.exitCode = 2;
    return;
  }

  const key = process.env.SERPAPI_API_KEY;
  const { result, report } = await runBoundedLiveCapabilityAudit(client, {
    apiKeyForRedaction: key,
  });

  console.log(
    JSON.stringify(
      {
        live: result.live,
        provider_status: result.provider_status,
        searches_consumed: result.searches_recorded,
        target_offer_count: result.target_offers.length,
        total_offer_count: result.offers.length,
        missing_fields: report.missing_fields,
        redacted_fixture_path: report.redacted_fixture_path,
        disclaimer: report.disclaimer,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Live audit failed: ${msg}`);
  process.exitCode = 1;
});
