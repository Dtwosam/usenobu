/**
 * Authenticated session cookie — httpOnly, secure in production.
 */
import { cookies } from "next/headers";
import { isVercelRuntime } from "../web/db.js";
import {
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_MAX_AGE_SECONDS,
} from "./config.js";

export async function readAuthSessionToken(): Promise<string | null> {
  try {
    const jar = await cookies();
    const v = jar.get(AUTH_SESSION_COOKIE)?.value;
    return v && v.length >= 16 ? v : null;
  } catch {
    return null;
  }
}

export async function writeAuthSessionToken(rawToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(AUTH_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isVercelRuntime() || process.env.NODE_ENV === "production",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearAuthSessionCookie(): Promise<void> {
  try {
    const jar = await cookies();
    jar.set(AUTH_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isVercelRuntime() || process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  } catch {
    /* RSC may not allow set — logout action always can */
  }
}
