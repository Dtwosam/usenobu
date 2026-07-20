/**
 * Magic-link callback — one-time token consumption.
 * Never exposes raw token errors to the client beyond generic states.
 */
import { NextResponse, type NextRequest } from "next/server";
import { completeMagicLinkVerification } from "@/web/auth-actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  try {
    const { redirectTo } = await completeMagicLinkVerification(token);
    return NextResponse.redirect(new URL(redirectTo, req.url));
  } catch (err) {
    console.error("auth_verify_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(new URL("/sign-in?error=invalid", req.url));
  }
}
