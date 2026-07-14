import fs from "node:fs";
const p = "docs/proof/okx/_tmp_act_out.txt";
let s = fs.readFileSync(p, "utf8");
const red = s
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
  .replace(/0x[a-fA-F0-9]{20,}/g, "[ADDR]")
  .replace(/Bearer\s+\S+/gi, "[BEARER]");
fs.writeFileSync("docs/proof/okx/gate4-activate-raw-redacted.txt", red.slice(0, 5000));
console.log(red.slice(0, 5000));
try {
  const j = JSON.parse(s.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop());
  fs.writeFileSync(
    "docs/proof/okx/gate4-activate-redacted.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        ok: j.ok,
        error: j.error
          ? {
              code: j.error.code ?? j.error.errorCode ?? null,
              message: j.error.message ?? j.error.msg ?? String(j.error).slice(0, 500),
              keys: typeof j.error === "object" ? Object.keys(j.error) : null,
            }
          : null,
        data: j.data ?? null,
        topKeys: Object.keys(j),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log("json_parse_fail", e.message);
}
try {
  fs.unlinkSync(p);
} catch {
  // ignore
}
