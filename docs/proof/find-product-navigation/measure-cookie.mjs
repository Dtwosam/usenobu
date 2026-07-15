/**
 * Measure enrollment cookie size (fixture evaluation, no network).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// Use built dist if needed — prefer dynamic import of ts via tsx runtime
const { openDatabase, migrateUp } = await import("../../../src/db/index.ts");
const { exportSnapshot } = await import("../../../src/web/session-snapshot.ts");
const { saveEnrollmentDiscovery } = await import(
  "../../../src/web/discovery-store.ts"
);
const { evaluateProductMatches } = await import(
  "../../../src/matching/index.ts"
);

const db = openDatabase(":memory:");
migrateUp(db);
const now = new Date().toISOString();
db.prepare(
  `INSERT INTO purchases (
    id, user_ref, target_product_url, purchase_price, currency, purchase_date,
    country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
    is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
    created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
).run(
  "pur_test123456",
  "demo-user",
  "https://www.target.com/p/apple-airtag/-/A-54191097",
  35,
  "USD",
  "2026-07-14",
  "US",
  "TX",
  "target_online",
  "AirTag",
  "194252096261",
  "54191097",
  0,
  null,
  "MATCH_REVIEW_REQUIRED",
  null,
  "2026-07-28",
  now,
  now,
);

const offers = [
  {
    title: "Apple AirTag",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    observed_price: 29.99,
    currency: "USD",
    merchant_link: "https://www.target.com/p/apple-airtag/-/A-54191097",
    target_item_id: "54191097",
    model_number: "AirTag",
  },
];
const evaluation = evaluateProductMatches(
  {
    target_product_url:
      "https://www.target.com/p/apple-airtag/-/A-54191097",
    target_item_id: "54191097",
    model_number: "AirTag",
    product_title: "Apple AirTag",
  },
  offers,
);
saveEnrollmentDiscovery(db, {
  purchase_id: "pur_test123456",
  data_source: "LIVE",
  query: "Apple AirTag Target",
  provider_status: "AMBIGUOUS_TARGET_RESULTS",
  evaluation,
  offers,
  created_at: now,
});

const snap = exportSnapshot(db);
const encoded = Buffer.from(JSON.stringify(snap), "utf8").toString("base64url");
const out = {
  purchases: snap.purchases.length,
  discovery_n: snap.enrollment_discovery?.length ?? 0,
  evaluation_json_len: String(
    snap.enrollment_discovery?.[0]?.evaluation_json ?? "",
  ).length,
  offers_json_len: String(snap.enrollment_discovery?.[0]?.offers_json ?? "")
    .length,
  json_len: JSON.stringify(snap).length,
  encoded_len: encoded.length,
  max: 3800,
  too_large: encoded.length > 3800,
  purchase_present: snap.purchases.some((p) => p.id === "pur_test123456"),
};
fs.writeFileSync(
  path.resolve("docs/proof/find-product-navigation/cookie-measure.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
