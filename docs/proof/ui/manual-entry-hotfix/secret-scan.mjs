import fs from "node:fs";
import path from "node:path";

const roots = ["src", "app", "tests", "docs", "openapi"];
const bad = [];

function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    if (
      ent.name === "node_modules" ||
      ent.name === ".next" ||
      ent.name === "test-results" ||
      ent.name === "playwright-report"
    ) {
      continue;
    }
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|md|json|yaml|yml|example)$/i.test(ent.name)) {
      const s = fs.readFileSync(p, "utf8");
      if (/gsk_[a-zA-Z0-9]{10,}/.test(s)) bad.push({ p, kind: "gsk" });
      if (/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(s))
        bad.push({ p, kind: "pem" });
      if (
        /XAI_API_KEY\s*=\s*[^\s#"']+/.test(s) &&
        !p.endsWith(".env.example")
      )
        bad.push({ p, kind: "xai_assign" });
    }
  }
}

for (const r of roots) walk(r);
const result = {
  at: new Date().toISOString(),
  secret_scan: bad.length ? "FAIL" : "PASS",
  hits: bad,
};
console.log(JSON.stringify(result, null, 2));
if (bad.length) process.exit(1);
