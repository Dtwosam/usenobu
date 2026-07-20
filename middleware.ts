/**
 * Mint a server-assigned session owner cookie for consumer routes.
 * Cookie writes are not allowed from Server Components; middleware +
 * server actions are the durable identity boundary (Lane 7.3A.2A).
 */
import { NextResponse, type NextRequest } from "next/server";

const OWNER_COOKIE = "nobu_owner_v1";
const OWNER_RE = /^usr_[a-f0-9]{32}$/;
const MAX_AGE = 60 * 60 * 24 * 30;

function newOwnerId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const existing = request.cookies.get(OWNER_COOKIE)?.value;
  if (existing && OWNER_RE.test(existing)) {
    return response;
  }

  const owner = newOwnerId();
  const secure =
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    process.env.NODE_ENV === "production";

  response.cookies.set(OWNER_COOKIE, owner, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: MAX_AGE,
  });
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/purchases/:path*",
    "/sign-in",
    "/auth/:path*",
  ],
};
