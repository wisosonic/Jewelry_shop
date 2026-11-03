import { prisma } from "../../db/prisma";
import { repriceAllProducts } from "../products/products.service";

/** Business logic for the singleton global app settings row (commission surcharges, currency). */

/** Fetches the singleton app settings row, creating it with defaults if it doesn't exist yet. */
export async function getSettings() {
  return (
    (await prisma.settings.findUnique({ where: { id: 1 } })) ??
    (await prisma.settings.create({ data: { id: 1 } }))
  );
}

type SettingsRow = Awaited<ReturnType<typeof getSettings>>;

/**
 * Picks the right selling-commission field for a given metal type - the one
 * place that decides "gold or silver" for pricing, so it's never
 * re-hardcoded at each call site. Falls back to the gold rate for anything
 * other than `"SILVER"`, the same defensive-narrowing convention used for
 * `Product.productType` elsewhere in this app (metal type is a plain
 * `String`, not a real enum - see domain invariant #3 in CLAUDE.md).
 */
export function sellingCommissionForMetal(settings: SettingsRow, metalType: string): number {
  return metalType === "SILVER"
    ? settings.commissionSellingSilverCentsPerTroyOunce
    : settings.commissionSellingGoldCentsPerTroyOunce;
}

/** Picks the right buying-commission field for a given metal type - see `sellingCommissionForMetal()`, its mirror image. */
export function buyingCommissionForMetal(settings: SettingsRow, metalType: string): number {
  return metalType === "SILVER"
    ? settings.commissionBuyingSilverCentsPerTroyOunce
    : settings.commissionBuyingGoldCentsPerTroyOunce;
}

/**
 * Updates app settings and immediately reprices every product, since
 * commission changes affect every product's price, not just future ones —
 * waiting for the next metals refresh would leave stale prices displayed.
 */
export async function updateSettings(input: {
  commissionSellingGoldCentsPerTroyOunce?: number;
  commissionSellingSilverCentsPerTroyOunce?: number;
  commissionBuyingGoldCentsPerTroyOunce?: number;
  commissionBuyingSilverCentsPerTroyOunce?: number;
  currency?: string;
  usdToLbpRate?: number;
  lowStockThreshold?: number;
  universalOtpCode?: string | null;
  otpVerificationEnabled?: boolean;
  metalPriceScheduleEnabled?: boolean;
  metalPriceRefreshFrequencyMinutes?: number;
}) {
  await getSettings();
  const data: typeof input = { ...input };
  // The admin form submits "" to mean "disabled" - store that as `null`.
  // Checked with `in`, not just falsiness, so omitting this field entirely
  // (e.g. an update that only touches the commission) doesn't accidentally
  // clear an existing universal code that wasn't part of this request.
  if ("universalOtpCode" in input) {
    data.universalOtpCode = input.universalOtpCode || null;
  }
  const settings = await prisma.settings.update({ where: { id: 1 }, data });

  await repriceAllProducts();

  return settings;
}
