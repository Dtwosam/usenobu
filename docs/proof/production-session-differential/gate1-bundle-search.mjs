/**
 * Search public alias HTML/JS for old vs new ambiguity copy.
 */
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const old =
  "We found more than one possible Target product. Add a model, TCIN or UPC so Nobu can avoid choosing the wrong item.";
const neu = "Nobu found several different Target products and could not safely choose one.";

const out = {
  at: new Date().toISOString(),
  base,
  old_copy: old,
  new_copy: neu,
  pages: {},
  chunks: { checked: 0, old: [], new: [] },
};

for (const p of ["/", "/purchases/new"]) {
  const r = await fetch(base + p);
  const html = await r.text();
  out.pages[p] = {
    status: r.status,
    old_in_html: html.includes(old),
    new_in_html: html.includes(neu),
  };
  const scripts = [
    ...html.matchAll(/\/_next\/static\/[^"'\\s]+\\.js/g),
  ].map((m) => m[0]);
  // also from src=
  const scripts2 = [
    ...html.matchAll(/src="(\/_next\/static\/[^"]+)"/g),
  ].map((m) => m[1]);
  const all = [...new Set([...scripts, ...scripts2])];
  for (const s of all.slice(0, 40)) {
    try {
      const t = await (await fetch(base + s)).text();
      out.chunks.checked += 1;
      if (t.includes(old) || t.includes("more than one possible Target product")) {
        out.chunks.old.push(s);
      }
      if (t.includes(neu) || t.includes("several different Target products")) {
        out.chunks.new.push(s);
      }
    } catch {
      /* ignore */
    }
  }
}

// Probe review route pattern (needs id - fetch may 404/redirect)
const reviewProbe = await fetch(base + "/purchases/pur_doesnotexist/review");
out.review_probe = {
  status: reviewProbe.status,
  redirected: reviewProbe.redirected,
  url: reviewProbe.url,
};

fs.mkdirSync("docs/proof/production-session-differential", { recursive: true });
fs.writeFileSync(
  path.resolve("docs/proof/production-session-differential/gate1-bundle.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
