import { formatDisplayPrice } from "../lib/format";
import { useCurrencyStore } from "../store/currencyStore";

/**
 * Returns a formatter for the shopper's currently selected display currency
 * (USD or LBP - see `currencyStore.ts`), for use on customer-facing price
 * displays. Admin screens should keep using `formatCents` directly, since
 * store management always operates in USD.
 */
export function useDisplayPrice() {
  const currency = useCurrencyStore((s) => s.currency);
  const usdToLbpRate = useCurrencyStore((s) => s.usdToLbpRate);
  return (cents: number) => formatDisplayPrice(cents, currency, usdToLbpRate);
}
