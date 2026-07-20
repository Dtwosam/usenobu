import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/policy/operations/auth";
import { getWebDatabase } from "@/web/db";
import { createLiveSerpApiObservationFetcher } from "@/web/live-monitor";
import { runScheduledMonitoringTick } from "@/monitoring/scheduler";

/**
 * POST /v1/owner/monitor-scheduler — bounded scheduled purchase checks.
 * Bearer: CRON_SECRET only.
 * At most one provider check per purchase / 24h, budget-bounded batch.
 * Does not scrape Target. Does not send emails without consent.
 */
export async function POST(req: Request) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const nowIso = new Date().toISOString();

  try {
    const db = getWebDatabase();
    const result = await runScheduledMonitoringTick({
      db,
      as_of: nowIso,
      fetchObservation: createLiveSerpApiObservationFetcher(),
      process_emails: true,
    });

    return NextResponse.json(
      {
        ok: true,
        ...result,
        note: "Bounded scheduled monitoring. No continuous polling. Email only with consent + new opportunity.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "scheduler_failed" }, { status: 500 });
  }
}
