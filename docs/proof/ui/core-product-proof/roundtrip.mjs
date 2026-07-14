import { migrateUp, openDatabase } from "../../../../src/db/index.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
} from "../../../../src/matching/index.js";
import {
  clearDemoTables,
  exportSnapshot,
  importSnapshot,
} from "../../../../src/web/session-snapshot.js";

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
const snap = exportSnapshot(db);
console.log("export matches", snap.product_matches.length, "fps", snap.product_fingerprints.length);

const db2 = openDatabase(":memory:");
migrateUp(db2);
try {
  clearDemoTables(db2);
  importSnapshot(db2, snap);
  const p = db2
    .prepare("SELECT fingerprint_id, status FROM purchases WHERE id=?")
    .get(purchaseId);
  const f = db2
    .prepare("SELECT fingerprint_id, length(fingerprint_json) as n FROM product_fingerprints")
    .all();
  console.log("roundtrip", { p, f, expected: fp.fingerprint_id });
} catch (e) {
  console.error("import_failed", e);
}
