import { z } from "zod";

/** ISO 8601 calendar date (YYYY-MM-DD). */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "purchase_date must be YYYY-MM-DD")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    if (y === undefined || m === undefined || d === undefined) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "purchase_date must be a real calendar date");

/** ISO 8601 date-time with timezone or Z. */
export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "must be ISO-8601 date-time with offset" });

/** Positive money amount (exclusive minimum 0). */
export const PositiveMoneySchema = z
  .number()
  .finite()
  .gt(0, "price must be greater than 0");

/** Non-negative money (recovery may be 0). */
export const NonNegativeMoneySchema = z
  .number()
  .finite()
  .min(0, "amount must be >= 0");

/** Target.com / Target product URL. */
export const TargetProductUrlSchema = z
  .string()
  .url("target_product_url must be a valid URL")
  .refine((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return (
        host === "target.com" ||
        host === "www.target.com" ||
        host.endsWith(".target.com")
      );
    } catch {
      return false;
    }
  }, "target_product_url must be a Target.com URL");

/** U.S. state / territory code (2 letters). Alaska/Hawaii accepted as input values; policy engine later rejects. */
export const UsRegionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "region must be a 2-letter U.S. code");

export const NonEmptyStringSchema = z.string().trim().min(1);

/** SHA-256 hex digest for raw result hashes. */
export const Sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "raw_result_hash must be 64-char hex SHA-256");
