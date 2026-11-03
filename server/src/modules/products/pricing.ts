// Mirrors the same constant in server/src/modules/metals/metals.service.ts
// and client/src/lib/format.ts. There's no shared package between client
// and server (and this module intentionally has no other imports so it
// stays a pure, dependency-free formula), so keep all three in sync
// manually if this ever changes.
const GRAMS_PER_TROY_OUNCE = 31.1034768;

/**
 * Shared product price formula: `((pricePerGram + commissionPerGram) *
 * weight * purity) + makingCharge`, rounded to the nearest cent. The
 * commission is a flat, fixed surcharge quoted per troy ounce (not a
 * percentage, and not per gram - see `Settings.commissionSellingGoldCentsPerTroyOunce`/
 * `commissionSellingSilverCentsPerTroyOunce`), so it's converted to a
 * per-gram amount before being added to the spot price; it can be negative
 * (a discount) as well as positive (a markup). This function itself takes
 * a single resolved `commissionCentsPerTroyOunce` number - it's the
 * caller's job (`settings.service.ts`'s `sellingCommissionForMetal()`) to
 * pick the gold or silver rate for the product being priced; this stays a
 * pure, metal-agnostic formula.
 *
 * `makingChargeCents` is added only for `productType: "JEWELRY"` -
 * bullion (bars/coins) is bought for its raw metal content, not crafted, so
 * it has no labor/fabrication cost to recoup the way a jewelry piece does.
 * A `BULLION` product's own `makingChargeCents` column is ignored here
 * regardless of what it's stored as (see `AdminProductForm.tsx`, which
 * hides the input entirely for bullion so an admin can't set one that
 * would silently do nothing).
 *
 * Used both when a product is created/edited and when metals.service
 * recomputes all products after a price/commission change.
 */
export function computePriceCents(params: {
  pricePerGramCents: number;
  weightGrams: number;
  purity: number;
  commissionCentsPerTroyOunce: number;
  makingChargeCents: number;
  productType: "JEWELRY" | "BULLION";
}): number {
  const commissionPerGramCents = params.commissionCentsPerTroyOunce / GRAMS_PER_TROY_OUNCE;
  const adjustedPricePerGramCents = params.pricePerGramCents + commissionPerGramCents;
  const metalValueCents = adjustedPricePerGramCents * params.weightGrams * params.purity;
  const makingChargeCents = params.productType === "JEWELRY" ? params.makingChargeCents : 0;
  return Math.round(metalValueCents + makingChargeCents);
}
