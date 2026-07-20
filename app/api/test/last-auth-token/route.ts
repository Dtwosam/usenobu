/**
 * Test/e2e only — returns last captured magic-link token for an email.
 * Never enabled without NOBU_AUTH_TEST_MODE / NODE_ENV=test / VITEST.
 */
import { NextResponse } from "next/server";
import { isAuthTestMode } from "@/auth/config";
import { normalizeEmail } from "@/auth/crypto";
import { peekLastCapturedTokenAsync } from "@/auth/email";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAuthTestMode()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  let email = "";
  try {
    const body = (await req.json()) as { email?: string };
    email = normalizeEmail(String(body.email ?? "")) || "";
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const token = await peekLastCapturedTokenAsync(email);
  if (!token) {
    return NextResponse.json({ error: "missing" }, { status: 404 });
  }
  return NextResponse.json({ token });
}
