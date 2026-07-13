import { SlidingWindowRateLimiter } from "../a2mcp/rate-limit.js";

/** Stricter limit for AI extraction: 10 / minute / client */
export const aiAgentRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
});
