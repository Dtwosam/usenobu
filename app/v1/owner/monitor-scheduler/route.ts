import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/policy/operations/auth";
import { getWebDatabase } from "@/web/db";
import { createLiveSerpApiObservationFetcher } from "@/web/live-monitor";
import { runScheduledMonitoringTickWithDurableBridge } from "@/monitoring/durable-bridge";

/**
 * POST /v1/owner/monitor-scheduler — bounded scheduled purchase checks.
 * Bearer: CRON_SECRET only.
 * Lane 7.4F: hydrates durable agent-originated monitors into local SQLite,
 * runs the existing scheduler tick, then persists account graphs back.
 * At most one provider check per purchase / 24h, budget-bounded batch.
 * Does not scrape Target. Does not send emails without consent.
 */
async function handle(req: Request) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const nowIso = new Date().toISOString();

  try {
    const db = getWebDatabase();
    const result = await runScheduledMonitoringTickWithDurableBridge({
      db,
      as_of: nowIso,
      fetchObservation: createLiveSerpApiObservationFetcher(),
      process_emails: true,
      use_durable_bridge: true,
    });

    return NextResponse.json(
      {
        ok: true,
        ...result,
        note: "Bounded scheduled monitoring with durable agent-monitor hydrate. No continuous polling. Email only with consent + new opportunity.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "scheduler_failed" }, { status: 500 });
  }
}

/** Vercel Cron invokes GET; operators may use POST. */
export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
