import { useEffect } from "react";
import { fetchLatestMetalPrices } from "../api/admin";
import { useCurrencyStore } from "../store/currencyStore";

/**
 * Keeps `currencyStore`'s cached USD->LBP rate fresh by fetching the public
 * `GET /metals/latest` endpoint, which already returns `usdToLbpRate`
 * alongside spot prices (see `settings.service.ts`). Called once from
 * `Navbar.tsx`'s currency toggle, which - unlike page components - is
 * mounted for the whole app session, so the rate is correct even on pages
 * that never render `MetalPricesPanel` (Cart, Checkout, order history,
 * etc.) instead of only becoming accurate once the shopper happens to visit
 * a page that shows live metal prices. `MetalPricesPanel` also updates the
 * same store as a side effect of its own fetch - both calls hit the same
 * cheap, cached-settings read (never metals.dev directly), so the
 * duplication is harmless and keeps the rate fresher on pages that show
 * live prices.
 */
export function useCurrencyRateSync() {
  const setUsdToLbpRate = useCurrencyStore((s) => s.setUsdToLbpRate);

  useEffect(() => {
    fetchLatestMetalPrices()
      .then((data) => setUsdToLbpRate(data.usdToLbpRate))
      .catch(() => {
        // Keep the cached/default rate if this fails - better than blocking the toggle.
      });
  }, [setUsdToLbpRate]);
}
