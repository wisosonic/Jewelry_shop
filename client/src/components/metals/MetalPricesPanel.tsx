import { useEffect, useState } from "react";
import { fetchLatestMetalPrices, type LatestMetalPrices } from "../../api/admin";
import { formatCentsPerTroyOunce, formatRelativeTime, formatSignedCommissionPerTroyOunce } from "../../lib/format";
import { useCurrencyStore } from "../../store/currencyStore";
import type { MetalPrice } from "../../types";

type Props = {
  /** "hero" is a larger standalone card for the landing page; "compact" is a slim inline strip for listings/dashboards. */
  variant?: "hero" | "compact";
};

/**
 * Fetches and displays the latest gold/silver spot price per troy ounce
 * (the conventional unit for quoting these prices, even though the app
 * stores and calculates per gram internally), the store's current sell/buy
 * commission surcharges for *each* metal separately (a flat, fixed amount
 * per troy ounce added to or subtracted from that metal's spot price - not
 * a percentage, and not per gram - see the schema comment on
 * `Settings.commissionSellingGoldCentsPerTroyOunce` on the server for why
 * gold and silver are set independently), and how long ago the prices were
 * fetched. Used on the landing page, shop listing, and admin screens so the
 * numbers that determine every product's price are always visible, not
 * just buried in the admin settings page. The commission values themselves
 * are set by an admin on `/admin/commission` (`AdminCommission.tsx`) - this
 * component only displays them.
 */
export function MetalPricesPanel({ variant = "compact" }: Props) {
  const [prices, setPrices] = useState<LatestMetalPrices | null>(null);
  const setUsdToLbpRate = useCurrencyStore((s) => s.setUsdToLbpRate);

  useEffect(() => {
    fetchLatestMetalPrices()
      .then((data) => {
        setPrices(data);
        setUsdToLbpRate(data.usdToLbpRate);
      })
      .catch(() =>
        setPrices({
          gold: null,
          silver: null,
          commissionSellingGoldCentsPerTroyOunce: 0,
          commissionSellingSilverCentsPerTroyOunce: 0,
          commissionBuyingGoldCentsPerTroyOunce: 0,
          commissionBuyingSilverCentsPerTroyOunce: 0,
          usdToLbpRate: 0,
        })
      );
  }, [setUsdToLbpRate]);

  // Render nothing until the first fetch resolves, rather than flashing a
  // "—" placeholder that immediately gets replaced.
  if (!prices) return null;

  const items: { label: string; price: MetalPrice | null; sellingCents: number; buyingCents: number }[] = [
    { label: "Gold", price: prices.gold, sellingCents: prices.commissionSellingGoldCentsPerTroyOunce, buyingCents: prices.commissionBuyingGoldCentsPerTroyOunce },
    { label: "Silver", price: prices.silver, sellingCents: prices.commissionSellingSilverCentsPerTroyOunce, buyingCents: prices.commissionBuyingSilverCentsPerTroyOunce },
  ];
  const lastFetchedAt = [prices.gold?.fetchedAt, prices.silver?.fetchedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  if (variant === "hero") {
    return (
      <div className="mx-auto flex max-w-md flex-wrap justify-center gap-6 rounded-2xl border border-brand-200 bg-white/80 px-8 py-5 shadow-sm backdrop-blur">
        {items.map(({ label, price, sellingCents, buyingCents }) => {
          const currency = price?.currency ?? "USD";
          return (
            <div key={label} className="min-w-[140px] flex-1 text-center">
              <p className="text-xs uppercase tracking-wide text-brand-500">{label} / troy oz</p>
              <p className="mt-1 text-2xl font-semibold text-brand-700">
                {price ? formatCentsPerTroyOunce(price.pricePerGramCents, price.currency) : "—"}
              </p>
              <p className="mt-1 text-xs text-ink-900/60">
                <span className="font-medium text-green-600">
                  {formatSignedCommissionPerTroyOunce(sellingCents, currency)}
                </span>{" "}
                sell &middot;{" "}
                <span className="font-medium text-red-600">
                  {formatSignedCommissionPerTroyOunce(buyingCents, currency)}
                </span>{" "}
                buy
              </p>
            </div>
          );
        })}
        <p className="w-full text-center text-xs text-ink-900/50">
          {lastFetchedAt ? `Updated ${formatRelativeTime(lastFetchedAt)}` : "Prices not yet available"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm">
      {items.map(({ label, price, sellingCents, buyingCents }) => {
        const currency = price?.currency ?? "USD";
        return (
          <span key={label} className="text-ink-900/80">
            <span className="font-medium text-brand-700">{label}:</span>{" "}
            {price ? `${formatCentsPerTroyOunce(price.pricePerGramCents, price.currency)}/oz` : "—"}{" "}
            (
            <span className="font-medium text-green-600">
              {formatSignedCommissionPerTroyOunce(sellingCents, currency)}
            </span>{" "}
            sell &middot;{" "}
            <span className="font-medium text-red-600">
              {formatSignedCommissionPerTroyOunce(buyingCents, currency)}
            </span>{" "}
            buy)
          </span>
        );
      })}
      <span className="text-xs text-ink-900/50">
        {lastFetchedAt ? `Updated ${formatRelativeTime(lastFetchedAt)}` : "Not yet available"}
      </span>
    </div>
  );
}
