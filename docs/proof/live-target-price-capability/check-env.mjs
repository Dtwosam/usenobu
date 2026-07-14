import fs from "node:fs";
const t = fs.readFileSync(".env.audit", "utf8");
for (const line of t.split(/\r?\n/)) {
  if (!/API|KEY|SERP|GROQ/i.test(line)) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  console.log(k, "len=" + v.length, "empty=" + (v.length === 0));
}
