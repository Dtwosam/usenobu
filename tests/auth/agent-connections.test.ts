/**
 * Lane 7.4B — agent connection + conversational email verification.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  createSqliteAuthStore,
  resetAuthStoreCache,
} from "../../src/auth/auth-store.js";
import {
  authorizeAgentConnection,
  beginAgentEmailVerification,
  revokeAgentConnectionAction,
  rotateAgentConnectionToken,
  verifyAgentEmailCode,
  AGENT_EMAIL_CODE_MAX_ATTEMPTS,
  AGENT_EMAIL_CODE_TTL_MS,
} from "../../src/auth/agent-connections.js";
import {
  clearCapturedAgentEmailCodes,
  peekCapturedAgentEmailCode,
} from "../../src/auth/email.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import { runAgentAction } from "../../src/ai/agent-service.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-agent-conn-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

describe("Lane 7.4B agent connections", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedAgentEmailCodes();
    resetAuthStoreCache();
    resetWebDatabaseCache();
  });

  afterEach(() => {
    resetWebDatabaseCache();
    resetAuthStoreCache();
    clearCapturedAgentEmailCodes();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  function openDb() {
    const db = openDatabase(dbPath);
    migrateUp(db);
    return db;
  }

  it("BEGIN_EMAIL_VERIFICATION sends a code and never reveals it publicly", async () => {
    const db = openDb();
    const result = await beginAgentEmailVerification({
      email: "agent-user@example.com",
      sourceKey: "src-1",
      sqliteDb: db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("EMAIL_CODE_SENT");
    expect(result.connection_id).toMatch(/^conn_/);
    expect(JSON.stringify(result)).not.toMatch(/"code"/);

    const rawCode = peekCapturedAgentEmailCode(result.connection_id);
    expect(rawCode).toMatch(/^\d{6}$/);
    db.close();
  });

  it("VERIFY_EMAIL_CODE succeeds once, consumes the code, and returns the token exactly once (stored only hashed)", async () => {
    const db = openDb();
    const begin = await beginAgentEmailVerification({
      email: "once@example.com",
      sqliteDb: db,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const rawCode = peekCapturedAgentEmailCode(begin.connection_id)!;

    const verified = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code: rawCode,
      sqliteDb: db,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.status).toBe("EMAIL_VERIFIED");
    expect(verified.connection_token.length).toBeGreaterThanOrEqual(32);

    // Stored only as a hash, never in plaintext.
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const row = await store.getAgentConnectionById(begin.connection_id);
    expect(row?.status).toBe("active");
    expect(row?.connection_token_hash).toBe(sha256Hex(verified.connection_token));
    expect(row?.connection_token_hash).not.toBe(verified.connection_token);

    // Replay of the same code fails — one-time consume.
    const replay = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code: rawCode,
      sqliteDb: db,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok && "status" in replay) expect(replay.status).toBe("CODE_INVALID");
    db.close();
  });

  it("concurrent/replayed verification of the same code: exactly one wins", async () => {
    const db = openDb();
    const begin = await beginAgentEmailVerification({
      email: "race@example.com",
      sqliteDb: db,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const rawCode = peekCapturedAgentEmailCode(begin.connection_id)!;

    const [a, b] = await Promise.all([
      verifyAgentEmailCode({ connectionId: begin.connection_id, code: rawCode, sqliteDb: db }),
      verifyAgentEmailCode({ connectionId: begin.connection_id, code: rawCode, sqliteDb: db }),
    ]);
    const okCount = [a, b].filter((r) => r.ok).length;
    expect(okCount).toBe(1);
    db.close();
  });

  it("expired code fails closed", async () => {
    const db = openDb();
    const start = new Date("2026-07-20T12:00:00.000Z");
    const begin = await beginAgentEmailVerification({
      email: "expired@example.com",
      now: start,
      sqliteDb: db,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const rawCode = peekCapturedAgentEmailCode(begin.connection_id)!;

    const after = new Date(start.getTime() + AGENT_EMAIL_CODE_TTL_MS + 1000);
    const verified = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code: rawCode,
      now: after,
      sqliteDb: db,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok && "status" in verified) expect(verified.status).toBe("CODE_EXPIRED");
    db.close();
  });

  it("exhausts after the maximum wrong attempts and forces a new BEGIN_EMAIL_VERIFICATION", async () => {
    const db = openDb();
    const begin = await beginAgentEmailVerification({
      email: "attempts@example.com",
      sqliteDb: db,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const rawCode = peekCapturedAgentEmailCode(begin.connection_id)!;
    const wrongCode = rawCode === "000000" ? "111111" : "000000";

    let lastStatus: string | undefined;
    for (let i = 0; i < AGENT_EMAIL_CODE_MAX_ATTEMPTS; i++) {
      const r = await verifyAgentEmailCode({
        connectionId: begin.connection_id,
        code: wrongCode,
        sqliteDb: db,
      });
      expect(r.ok).toBe(false);
      if (!r.ok && "status" in r) lastStatus = r.status;
    }
    expect(lastStatus).toBe("CODE_EXPIRED");

    // Even the correct code no longer works — a fresh BEGIN_EMAIL_VERIFICATION is required.
    const afterExhaustion = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code: rawCode,
      sqliteDb: db,
    });
    expect(afterExhaustion.ok).toBe(false);
    db.close();
  });

  it("authorization: unknown, wrong, expired, and revoked credentials are all rejected the same way", async () => {
    const db = openDb();
    const begin = await beginAgentEmailVerification({
      email: "auth@example.com",
      sqliteDb: db,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const rawCode = peekCapturedAgentEmailCode(begin.connection_id)!;
    const verified = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code: rawCode,
      sqliteDb: db,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    // Unknown connection id.
    const unknown = await authorizeAgentConnection({
      connectionId: "conn_does_not_exist",
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(unknown.ok).toBe(false);

    // Handle-only — no token supplied.
    const noToken = await authorizeAgentConnection({
      connectionId: verified.connection_id,
      connectionToken: "",
      sqliteDb: db,
    });
    expect(noToken.ok).toBe(false);

    // Wrong token.
    const wrong = await authorizeAgentConnection({
      connectionId: verified.connection_id,
      connectionToken: "not-the-real-token-xxxxxxxxxxxxxxxx",
      sqliteDb: db,
    });
    expect(wrong.ok).toBe(false);

    // Expired credential.
    const farFuture = new Date(
      Date.parse(verified.credential_expires_at) + 1000,
    );
    const expired = await authorizeAgentConnection({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      now: farFuture,
      sqliteDb: db,
    });
    expect(expired.ok).toBe(false);

    // Valid token still works before expiry.
    const ok = await authorizeAgentConnection({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(ok.ok).toBe(true);

    // Revoke, then even the previously-valid token is rejected.
    const revoked = await revokeAgentConnectionAction({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(revoked.ok).toBe(true);
    const afterRevoke = await authorizeAgentConnection({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(afterRevoke.ok).toBe(false);
    db.close();
  });

  it("rotation replaces the token hash and immediately invalidates the old token", async () => {
    const db = openDb();
    const begin = await beginAgentEmailVerification({
      email: "rotate@example.com",
      sqliteDb: db,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const rawCode = peekCapturedAgentEmailCode(begin.connection_id)!;
    const verified = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code: rawCode,
      sqliteDb: db,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const oldToken = verified.connection_token;
    const rotated = await rotateAgentConnectionToken({
      connectionId: verified.connection_id,
      sqliteDb: db,
    });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.connection_token).not.toBe(oldToken);

    const oldStillWorks = await authorizeAgentConnection({
      connectionId: verified.connection_id,
      connectionToken: oldToken,
      sqliteDb: db,
    });
    expect(oldStillWorks.ok).toBe(false);

    const newWorks = await authorizeAgentConnection({
      connectionId: verified.connection_id,
      connectionToken: rotated.connection_token,
      sqliteDb: db,
    });
    expect(newWorks.ok).toBe(true);
    db.close();
  });

  it("revocation requires valid authorization and blocks further protected actions", async () => {
    const db = openDb();
    const begin = await beginAgentEmailVerification({
      email: "revoke@example.com",
      sqliteDb: db,
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const rawCode = peekCapturedAgentEmailCode(begin.connection_id)!;
    const verified = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code: rawCode,
      sqliteDb: db,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    // Wrong token cannot revoke.
    const badRevoke = await revokeAgentConnectionAction({
      connectionId: verified.connection_id,
      connectionToken: "wrong-token-value-xxxxxxxxxxxxxxxx",
      sqliteDb: db,
    });
    expect(badRevoke.ok).toBe(false);
    if (!badRevoke.ok) expect(badRevoke.status).toBe("ACTION_NOT_AUTHORIZED");

    const goodRevoke = await revokeAgentConnectionAction({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(goodRevoke.ok).toBe(true);
    if (goodRevoke.ok) expect(goodRevoke.status).toBe("CONNECTION_REVOKED");

    // Revoking again fails — already revoked, no longer authorized.
    const secondRevoke = await revokeAgentConnectionAction({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(secondRevoke.ok).toBe(false);
    db.close();
  });

  it("two connections cannot authorize each other", async () => {
    const db = openDb();
    const beginA = await beginAgentEmailVerification({
      email: "conn-a@example.com",
      sqliteDb: db,
    });
    const beginB = await beginAgentEmailVerification({
      email: "conn-b@example.com",
      sqliteDb: db,
    });
    expect(beginA.ok && beginB.ok).toBe(true);
    if (!beginA.ok || !beginB.ok) return;

    const codeA = peekCapturedAgentEmailCode(beginA.connection_id)!;
    const codeB = peekCapturedAgentEmailCode(beginB.connection_id)!;
    const verifiedA = await verifyAgentEmailCode({
      connectionId: beginA.connection_id,
      code: codeA,
      sqliteDb: db,
    });
    const verifiedB = await verifyAgentEmailCode({
      connectionId: beginB.connection_id,
      code: codeB,
      sqliteDb: db,
    });
    expect(verifiedA.ok && verifiedB.ok).toBe(true);
    if (!verifiedA.ok || !verifiedB.ok) return;

    // A's id with B's token.
    const crossed1 = await authorizeAgentConnection({
      connectionId: verifiedA.connection_id,
      connectionToken: verifiedB.connection_token,
      sqliteDb: db,
    });
    expect(crossed1.ok).toBe(false);

    // B's id with A's token.
    const crossed2 = await authorizeAgentConnection({
      connectionId: verifiedB.connection_id,
      connectionToken: verifiedA.connection_token,
      sqliteDb: db,
    });
    expect(crossed2.ok).toBe(false);

    // Each still works with its own token.
    expect(
      (
        await authorizeAgentConnection({
          connectionId: verifiedA.connection_id,
          connectionToken: verifiedA.connection_token,
          sqliteDb: db,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await authorizeAgentConnection({
          connectionId: verifiedB.connection_id,
          connectionToken: verifiedB.connection_token,
          sqliteDb: db,
        })
      ).ok,
    ).toBe(true);
    db.close();
  });

  it("per-email rate limit blocks after repeated BEGIN_EMAIL_VERIFICATION for the same address", async () => {
    const db = openDb();
    let lastOk = true;
    for (let i = 0; i < 10; i++) {
      const r = await beginAgentEmailVerification({
        email: "ratelimited@example.com",
        sourceKey: `src-${i}`,
        sqliteDb: db,
      });
      lastOk = r.ok;
      if (!r.ok) {
        expect(r.error).toBe("rate_limited");
        break;
      }
    }
    expect(lastOk).toBe(false);
    db.close();
  });

  it("full agent-service dispatch: BEGIN_EMAIL_VERIFICATION -> VERIFY_EMAIL_CODE -> REVOKE_AGENT_CONNECTION over /v1/agent", async () => {
    const db = openDb();
    const begin = await runAgentAction(
      { action: "BEGIN_EMAIL_VERIFICATION", email: "e2e@example.com" },
      { sqliteDb: db, sourceKey: "e2e-src" },
    );
    expect(begin.http_status).toBe(200);
    const beginBody = begin.body as {
      agent_state: string;
      status: string;
      connection_id: string;
    };
    expect(beginBody.agent_state).toBe("EMAIL_VERIFICATION");
    expect(beginBody.status).toBe("EMAIL_CODE_SENT");

    const rawCode = peekCapturedAgentEmailCode(beginBody.connection_id)!;
    const verify = await runAgentAction(
      {
        action: "VERIFY_EMAIL_CODE",
        connection_id: beginBody.connection_id,
        code: rawCode,
      },
      { sqliteDb: db },
    );
    expect(verify.http_status).toBe(200);
    const verifyBody = verify.body as {
      status: string;
      connection_id: string;
      connection_token: string;
    };
    expect(verifyBody.status).toBe("EMAIL_VERIFIED");
    expect(verifyBody.connection_token).toBeTruthy();

    const wrongRevoke = await runAgentAction(
      {
        action: "REVOKE_AGENT_CONNECTION",
        connection_id: verifyBody.connection_id,
        connection_token: "wrong-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
      { sqliteDb: db },
    );
    expect(wrongRevoke.http_status).toBe(401);

    const revoke = await runAgentAction(
      {
        action: "REVOKE_AGENT_CONNECTION",
        connection_id: verifyBody.connection_id,
        connection_token: verifyBody.connection_token,
      },
      { sqliteDb: db },
    );
    expect(revoke.http_status).toBe(200);
    expect(revoke.body).toMatchObject({ status: "CONNECTION_REVOKED" });

    // No raw code or token anywhere in the response bodies' JSON keys we didn't expect.
    expect(JSON.stringify(begin.body)).not.toContain(rawCode);
    db.close();
  });

  it("existing /v1/agent actions are unchanged by the new agent-connection actions", async () => {
    const invalid = await runAgentAction({ action: "HACK_THE_PLANET" });
    expect(invalid.http_status).toBe(400);

    const check = await runAgentAction(
      {
        action: "CHECK_CONFIRMED_PURCHASE",
        target_product_url: "https://www.target.com/p/x/-/A-12345",
        purchase_price: 10,
        currency: "USD",
        purchase_date: "2026-07-10",
        country: "US",
        region: "TX",
        purchase_channel: "target_online",
      },
      { offersOverride: [], skipPolicyFreshness: true },
    );
    expect(check.http_status).toBe(200);
    expect(check.body).toHaveProperty("final_decision_by", "Target");
  });
});
