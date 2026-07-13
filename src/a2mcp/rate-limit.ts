/**
 * Simple sliding-window rate limiter (per process / per key).
 * Stateless endpoint — no shared SQLite. Production multi-instance should
 * front with edge/CDN limits; this enforces in-process safety.
 */

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retry_after_ms: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly config: RateLimitConfig) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const windowStart = now - this.config.windowMs;
    const prev = this.hits.get(key) ?? [];
    const recent = prev.filter((t) => t > windowStart);

    if (recent.length >= this.config.maxRequests) {
      const oldest = recent[0] ?? now;
      this.hits.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retry_after_ms: Math.max(0, oldest + this.config.windowMs - now),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      remaining: Math.max(0, this.config.maxRequests - recent.length),
      retry_after_ms: 0,
    };
  }

  /** Test helper */
  reset(): void {
    this.hits.clear();
  }
}

/** Default free A2MCP limit: 30 requests / minute / client key */
export const defaultA2mcpRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
});
