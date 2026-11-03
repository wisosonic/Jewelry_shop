import { z } from "zod";

/** Validation schemas for the admin revenue endpoints. */

// The trend chart's granularity is always monthly, even when filtered by
// exact dates (see `revenue.service.ts`'s `getRevenueSummary()`) - this
// bounds how many calendar months a `fromDate`/`toDate` range is allowed to
// span, the same "fat-finger backstop, not a policy limit" spirit as the
// commission bounds in `settings.schema.ts` (an admin picking a genuinely
// multi-year range by mistake shouldn't silently generate a huge chart).
export const MAX_FILTERED_TREND_MONTHS = 36;

/**
 * Query params for `GET /revenue/summary` - `months` controls how many
 * trailing monthly buckets the trend series covers (including the current,
 * still-in-progress month) when no specific range is requested. `fromDate`/
 * `toDate` are an optional pair - when both are given, the trend is scoped
 * to that exact date range instead of the trailing `months`-month window
 * (`months` is simply ignored in that case) - see `getRevenueSummary()` for
 * exactly how the range maps onto the trend's monthly buckets. They must be
 * given together, never just one, and `toDate` can't be before `fromDate` -
 * the `.refine()`s below enforce both (see `middleware/validate.ts`'s note
 * on schemas built with `.refine()`/`.transform()` also being supported,
 * not just plain `z.object()`s). Plain "YYYY-MM-DD" strings from an
 * `<input type="date">`, `z.coerce.date()`'d here so the service never has
 * to parse a raw string itself - the same convention
 * `orders.schema.ts`'s `listOrdersQuerySchema` already uses for its own
 * `fromDate`/`toDate` (though that one leaves the two independently
 * optional, since it's filtering a list, not shaping a fixed-granularity
 * chart - this endpoint's monthly bucketing needs a real span to enumerate,
 * so both are required together here).
 */
export const revenueSummaryQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(24).default(12),
    fromDate: z.coerce.date().optional(),
    toDate: z.coerce.date().optional(),
  })
  .refine((data) => (data.fromDate === undefined) === (data.toDate === undefined), {
    message: "fromDate and toDate must be provided together",
  })
  .refine((data) => !data.fromDate || !data.toDate || data.toDate.getTime() >= data.fromDate.getTime(), {
    message: "toDate must be on or after fromDate",
  })
  .refine(
    (data) => {
      if (!data.fromDate || !data.toDate) return true;
      const monthSpan =
        (data.toDate.getUTCFullYear() - data.fromDate.getUTCFullYear()) * 12 +
        (data.toDate.getUTCMonth() - data.fromDate.getUTCMonth()) +
        1;
      return monthSpan <= MAX_FILTERED_TREND_MONTHS;
    },
    { message: `The date range can span at most ${MAX_FILTERED_TREND_MONTHS} months.` }
  );
