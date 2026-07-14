import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BIN = path.join(
  process.env.USERPROFILE || "",
  ".onchainos",
  "bin",
  "onchainos.exe",
);
const PROOF = path.join(process.cwd(), "docs/proof/okx");

function getAgents() {
  const r = spawnSync(BIN, ["agent", "get-my-agents", "--role", "asp"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  try {
    return JSON.parse((r.stdout || "").trim());
  } catch {
    return { ok: false, raw: (r.stdout || "").slice(0, 2000), status: r.status };
  }
}

function walk(o, acc = []) {
  if (!o || typeof o !== "object") return acc;
  if (Array.isArray(o)) {
    for (const x of o) walk(x, acc);
    return acc;
  }
  const id = o.agentId ?? o.id;
  if (id != null && (o.name || o.agentName || o.role != null || o.agentRole != null)) {
    acc.push({
      agentId: id,
      name: o.name || o.agentName || null,
      role: o.role ?? o.agentRole ?? null,
      status: o.status ?? o.agentStatus ?? null,
    });
  }
  for (const v of Object.values(o)) walk(v, acc);
  return acc;
}

let found = [];
for (let i = 1; i <= 8; i++) {
  const j = getAgents();
  found = walk(j);
  console.log(
    JSON.stringify({
      poll: i,
      ok: j.ok,
      topKeys: Object.keys(j || {}),
      dataKeys: j.data ? Object.keys(j.data) : null,
      count: found.length,
      agents: found,
    }),
  );
  if (found.length) break;
  // wait 5s
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000)"]);
}

fs.writeFileSync(
  path.join(PROOF, "gate3-my-agents-redacted.json"),
  JSON.stringify(
    { at: new Date().toISOString(), agents: found, count: found.length },
    null,
    2,
  ),
);

// Also dump redacted structure sample if empty
if (!found.length) {
  const j = getAgents();
  const snip = JSON.stringify(j)
    .replace(/0x[a-fA-F0-9]{8,}/g, "[ADDR]")
    .replace(/https?:\/\/[^"\\s]+/g, "[URL]")
    .slice(0, 3000);
  fs.writeFileSync(
    path.join(PROOF, "gate3-my-agents-structure.json"),
    JSON.stringify({ snip }, null, 2),
  );
}

process.exit(found.length ? 0 : 1);
