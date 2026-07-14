import { migrateUp, openDatabase } from "../../../../src/db/index.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
} from "../../../../src/matching/index.js";
import { exportSnapshot } from "../../../../src/web/session-snapshot.js";
import { runMonitoringPass } from "../../../../src/monitoring/index.js";
import { buildFixtureMonitorOffers } from "../../../../src/web/fixtures.js";

const db = openDatabase(":memory:");
migrateUp(db);
const purchaseId = "pur_test";
db.prepare(
  `INSERT INTO purchases (
    id, user_ref, target_product_url, purchase_price, currency, purchase_date,
    country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
    is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
    created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
).run(
  purchaseId,
  "demo-user",
  "https://www.target.com/p/example-widget/-/A-87654321",
  39.99,
  "USD",
  "2026-07-01",
  "US",
  "TX",
  "target_online",
  "WDG-100",
  null,
  "87654321",
  0,
  null,
  "MATCH_REVIEW_REQUIRED",
  null,
  "2026-07-15",
  "2026-07-01T00:00:00.000Z",
  "2026-07-01T00:00:00.000Z",
);
const purchase = {
  purchase_id: purchaseId,
  target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
  target_item_id: "87654321",
  model_number: "WDG-100",
  product_title: "Example Widget Blue",
};
const offer = {
  offer_id: "seed",
  title: "Example Widget Blue",
  seller_kind: "target",
  seller_text: "Target",
  is_target_plus: false,
  merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
  target_item_id: "87654321",
  model_number: "WDG-100",
  observed_price: 39.99,
  currency: "USD",
};
const evaluation = evaluateProductMatches(purchase, [offer]);
const fp = confirmAndPersistLockedFingerprint({
  db,
  purchase,
  candidate: evaluation.exact_candidate,
  confirmed_at: "2026-07-02T00:00:00.000Z",
});

function sizeOf(label) {
  const snap = exportSnapshot(db);
  const encoded = Buffer.from(JSON.stringify(snap), "utf8").toString("base64url");
  console.log(label, {
    purchases: snap.purchases.length,
    fps: snap.product_fingerprints.length,
    matches: snap.product_matches.length,
    obs: snap.price_observations.length,
    alerts: snap.alerts.length,
    runs: snap.monitor_runs.length,
    encoded_len: encoded.length,
    fp_json_len: String(snap.product_fingerprints[0]?.fingerprint_json ?? "").length,
    first_fp_keys: Object.keys(snap.product_fingerprints[0] ?? {}),
  });
}

sizeOf("after_confirm");

await runMonitoringPass({
  db,
  mode: "manual",
  as_of: new Date().toISOString(),
  purchase_id: purchaseId,
  fetchObservation: () => ({
    offers: buildFixtureMonitorOffers({
      target_product_url: fp.target_product_url,
      target_item_id: fp.target_item_id,
      model_number: fp.model_number,
      product_title: fp.product_title,
      observed_price: 29.99,
    }),
    provider_status: "LIVE_TARGET_MATCH",
    consumed_search: true,
    query: "demo",
    observed_at: new Date().toISOString(),
    raw_result_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }),
});

sizeOf("after_check");
