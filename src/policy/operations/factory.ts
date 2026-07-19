/**
 * Server-only factory: one shared PolicyOperationsStore for all consumers.
 * Production requires Postgres URL — never falls back to memory or /tmp.
 */

import path from "node:path";
import {
  PolicyStoreUnavailableError,
  type PolicyOperationsStore,
} from "./contract.js";
import { createMemoryPolicyStore } from "./adapters/memory-adapter.js";
import { createSqlitePolicyStore } from "./adapters/sqlite-adapter.js";
import { createPostgresPolicyStore } from "./adapters/postgres-adapter.js";

let cached: PolicyOperationsStore | null = null;
let testOverride: PolicyOperationsStore | null = null;

export function isProductionRuntime(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    process.env.NODE_ENV === "production"
  );
}

/** Prefer dedicated policy URL; fall back to generic DATABASE_URL. */
export function resolvePolicyDatabaseUrl(): string | null {
  const dedicated = process.env.POLICY_OPS_DATABASE_URL?.trim();
  if (dedicated) return dedicated;
  const shared = process.env.DATABASE_URL?.trim();
  if (shared) return shared;
  return null;
}

export function isTmpSqlitePath(dbPath: string): boolean {
  const normalized = dbPath.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/tmp/") ||
    normalized.startsWith("/tmp") ||
    normalized.includes("\\tmp\\")
  );
}

/** Test-only injection. */
export function setPolicyOperationsStoreForTests(
  store: PolicyOperationsStore | null,
): void {
  testOverride = store;
  cached = null;
}

export function resetPolicyOperationsStoreCache(): void {
  cached = null;
}

export function createMemoryPolicyStoreForTests(): PolicyOperationsStore {
  return createMemoryPolicyStore();
}

/**
 * Resolve the shared store. Idempotent schema + approved-policy seed.
 * Production without Postgres URL → PolicyStoreUnavailableError (no silent fallback).
 */
export async function getPolicyOperationsStore(): Promise<PolicyOperationsStore> {
  if (testOverride) return testOverride;
  if (cached) return cached;

  const pgUrl = resolvePolicyDatabaseUrl();
  if (pgUrl) {
    const store = createPostgresPolicyStore(pgUrl);
    await store.ensureSchema();
    await store.ensureInitialized();
    cached = store;
    return store;
  }

  if (isProductionRuntime()) {
    throw new PolicyStoreUnavailableError(
      "policy_ops_store_unavailable: POLICY_OPS_DATABASE_URL or DATABASE_URL required in production",
    );
  }

  // Local / test default: file SQLite outside /tmp (or :memory: when forced)
  const configured =
    process.env.NOBU_POLICY_OPS_DB_PATH?.trim() ||
    path.join(process.cwd(), "data", "nobu.policy-ops.sqlite");

  if (isTmpSqlitePath(configured) && process.env.NOBU_ALLOW_TMP_POLICY_OPS !== "1") {
    throw new PolicyStoreUnavailableError(
      "policy_ops_store_unavailable: /tmp SQLite is forbidden for policy operations",
    );
  }

  const store = createSqlitePolicyStore(configured);
  await store.ensureSchema();
  await store.ensureInitialized();
  cached = store;
  return store;
}

/**
 * Safe health probe: never invent CURRENT from empty memory.
 */
export async function tryGetPolicyOperationsStore(): Promise<
  | { ok: true; store: PolicyOperationsStore }
  | { ok: false; error: string }
> {
  try {
    const store = await getPolicyOperationsStore();
    return { ok: true, store };
  } catch (err) {
    if (err instanceof PolicyStoreUnavailableError) {
      return { ok: false, error: err.code };
    }
    const message =
      err instanceof Error ? err.message.slice(0, 120) : "store_error";
    // Never include connection strings
    return {
      ok: false,
      error: message.includes("postgres")
        ? "policy_ops_store_unavailable"
        : "policy_ops_store_unavailable",
    };
  }
}
