import { z } from "zod";

// A flat, fixed surcharge per troy ounce, in integer cents (domain invariant
// #6 in CLAUDE.md) - bounded to a wide but sane range (-$5,000 to $5,000)
// purely as a fat-finger backstop (an extra zero, a misplaced decimal point),
// not a policy limit on where an admin is allowed to price things. Exported
// so AdminSettings.tsx can mirror the same bounds client-side for immediate
// feedback - duplicated rather than shared, like every other client/server
// constant in this app (no shared package - see CLAUDE.md).
export const COMMISSION_CENTS_PER_TROY_OUNCE_MIN = -500_000;
export const COMMISSION_CENTS_PER_TROY_OUNCE_MAX = 500_000;

// How often the automatic metal-price refresh runs, in minutes - see the
// schema comment on Settings.metalPriceRefreshFrequencyMinutes. 1 minute
// minimum (immediate, effectively); 1440 (24h) maximum, a sane upper bound
// rather than a policy limit. Exported for AdminSettings.tsx to mirror
// client-side, same convention as the commission bounds above.
export const METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MIN = 1;
export const METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MAX = 1440;

// Applies to one metal at a time; there are four of these fields
// (selling/buying x gold/silver) below, all sharing this same bound.
const commissionField = z
  .number()
  .int()
  .min(COMMISSION_CENTS_PER_TROY_OUNCE_MIN)
  .max(COMMISSION_CENTS_PER_TROY_OUNCE_MAX)
  .optional();

/**
 * Request body schema for updating app settings. The commission fields are a
 * flat, fixed surcharge on the spot metal price quoted per troy ounce and
 * stored in integer cents, not a percentage and not per gram - any integer
 * within the bounds above is valid, including negative (a discount) or zero.
 * Split by metal type (gold/silver) - see the schema comment on
 * `Settings.commissionSellingGoldCentsPerTroyOunce` in schema.prisma.
 */
export const updateSettingsSchema = z.object({
  commissionSellingGoldCentsPerTroyOunce: commissionField,
  commissionSellingSilverCentsPerTroyOunce: commissionField,
  commissionBuyingGoldCentsPerTroyOunce: commissionField,
  commissionBuyingSilverCentsPerTroyOunce: commissionField,
  currency: z.string().min(1).optional(),
  // How many Lebanese pounds one US dollar converts to - display-only (see
  // the domain invariant in CLAUDE.md); never used in any stored price.
  usdToLbpRate: z.number().positive().optional(),
  // Inclusive stockQuantity threshold for the admin low-stock alert list.
  lowStockThreshold: z.number().int().min(0).optional(),
  // A deliberate OTP-verification bypass, admin-set - see the domain
  // invariant in CLAUDE.md and Settings.universalOtpCode's schema comment.
  // An empty string is how the admin form clears/disables it - normalized
  // to `null` in settings.service.ts, not stored as "".
  universalOtpCode: z
    .string()
    .regex(/^\d{5}$/, "Must be exactly 5 digits")
    .or(z.literal(""))
    .nullable()
    .optional(),
  // Master switch for the registration OTP flow - see the schema comment on
  // Settings.otpVerificationEnabled and auth.service.ts's registerUser().
  otpVerificationEnabled: z.boolean().optional(),
  // Master switch for the automatic metal-price refresh (cron + boot fetch)
  // - see the schema comment on Settings.metalPriceScheduleEnabled and
  // metals.scheduler.ts. Never gates the admin's manual "refresh now" button.
  metalPriceScheduleEnabled: z.boolean().optional(),
  // How often the automatic refresh runs, in minutes - see the schema
  // comment on Settings.metalPriceRefreshFrequencyMinutes.
  metalPriceRefreshFrequencyMinutes: z
    .number()
    .int()
    .min(METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MIN)
    .max(METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MAX)
    .optional(),
});
