/**
 * Formats an integer amount in cents as a localized currency string (e.g.
 * `1050` -> `"$10.50"`). Pass `fractionDigits` to override the default
 * 2-decimal precision (e.g. `0` for whole-dollar display) - the underlying
 * value is still always integer cents; this only affects display rounding.
 */
export function formatCents(cents: number, currency = "USD", fractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cents / 100);
}

// Mirrors the same constant in server/src/modules/metals/metals.service.ts,
// which converts metals.dev's per-troy-ounce API response into the
// per-gram cents stored on MetalPrice/Product (the unit the pricing
// formula uses, since it's multiplied by weightGrams). There's no shared
// package between client and server, so keep these two in sync manually if
// either ever changes.
const GRAMS_PER_TROY_OUNCE = 31.1034768;

/**
 * Formats a per-gram price in cents as a localized currency string
 * per troy ounce - the unit gold/silver prices are conventionally quoted
 * in, even though the app stores and calculates everything per gram.
 */
export function formatCentsPerTroyOunce(pricePerGramCents: number, currency = "USD"): string {
  return formatCents(pricePerGramCents * GRAMS_PER_TROY_OUNCE, currency);
}

/**
 * Formats a commission surcharge (in cents, positive = markup, negative =
 * discount off spot - see the `Settings.commissionSellingCentsPerTroyOunce`/
 * `commissionBuyingCentsPerTroyOunce` doc comments) as an explicitly-signed
 * currency string. Unlike `formatCentsPerTroyOunce`, this does **not**
 * multiply by `GRAMS_PER_TROY_OUNCE` - the commission is already a fixed
 * amount quoted per troy ounce, not a per-gram value - e.g. `5000` ->
 * `"+$50"`, `-3000` -> `"-$30"`. Displayed with 0-decimal precision (rounded
 * to the nearest whole dollar) since commission is a coarse, deliberately
 * round surcharge, unlike prices - the stored value is still exact cents.
 */
export function formatSignedCommissionPerTroyOunce(commissionCentsPerTroyOunce: number, currency = "USD"): string {
  const magnitude = formatCents(Math.abs(commissionCentsPerTroyOunce), currency, 0);
  return commissionCentsPerTroyOunce < 0 ? `-${magnitude}` : `+${magnitude}`;
}

/**
 * Formats an integer amount in USD cents for display in the shopper's chosen
 * currency (see `store/currencyStore.ts`) - USD is shown as-is via
 * `formatCents`; LBP is a pure display-time conversion using the admin's
 * `Settings.usdToLbpRate`, rounded to whole LBP (no fractional Lebanese
 * pounds in practice). This is display-only: nothing about the underlying
 * price, cart line, or order is ever stored or snapshotted in LBP - see the
 * `Settings.usdToLbpRate` schema comment.
 */
export function formatDisplayPrice(cents: number, currency: "USD" | "LBP", usdToLbpRate: number): string {
  if (currency === "LBP") {
    const lbpAmount = Math.round((cents / 100) * usdToLbpRate);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "LBP",
      maximumFractionDigits: 0,
    }).format(lbpAmount);
  }
  return formatCents(cents);
}

/**
 * Formats an ISO timestamp as a short relative time string (e.g. "5 min
 * ago", "3 hr ago"), falling back to a locale date/time string once it's a
 * week or more old. Used to show how fresh a metal price quote is.
 */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return new Date(iso).toLocaleString();
}
