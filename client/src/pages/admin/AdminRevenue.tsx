import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { fetchRevenueSummary } from "../../api/admin";
import { formatCents } from "../../lib/format";
import type { RevenueSummary } from "../../types";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a plain `"YYYY-MM-DD"` date string (e.g. from
 * `RevenueSummary.filteredRange`) as "Mon D, YYYY" - by parsing the string
 * directly rather than going through `new Date(...)`/`toLocaleDateString()`,
 * which would interpret the date in the browser's local timezone and could
 * display a day off from what was actually requested/applied.
 */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTH_ABBR[month - 1]} ${day}, ${year}`;
}

/**
 * Admin revenue report: total earned vs pending revenue (each with a "View
 * orders" link through to `AdminOrders.tsx` pre-filtered to exactly the
 * orders behind that number - `?status=EARNED`/`?status=PENDING`, read by
 * that page's own `useSearchParams` seed), a monthly earned/pending trend
 * chart (recharts - the only charting dependency in this client, added
 * specifically for this page) - optionally scoped to an exact date range
 * via a "From"/"To" date-input pair (same `<input type="date">` pattern
 * `AdminOrders.tsx`'s own date-range filter uses) and an explicit "Apply"
 * button (staged, not immediate-save, so picking a date doesn't re-fetch
 * on every keystroke) - and a per-category breakdown table. "Earned"
 * means order status CONFIRMED/SHIPPED/DELIVERED (money realized);
 * "pending" means PENDING (not yet realized); CANCELLED orders count as
 * neither - see `revenue.service.ts` on the server, the single source of
 * truth for this split (and `orders.service.ts`'s `listAllOrders()`,
 * which resolves the same `EARNED_ORDER_STATUSES` bucket for the "View
 * orders" link rather than re-deriving it). The date-range filter only
 * ever affects the trend chart - the two stat tiles and the category
 * table stay all-time regardless of whether a range is applied, matching
 * `getRevenueSummary()`'s own scoping on the server. The chart's bucket
 * granularity stays monthly even when filtered - a range that starts or
 * ends mid-month still shows a real bucket for that month, just totalling
 * only the in-range days within it (see that server function's own doc
 * comment for the exact split between "which orders count" - exact days -
 * and "which bucket keys exist" - whole months the range touches).
 */
export function AdminRevenue() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Staged date inputs, independent of what's actually applied - only the
  // "Apply" button commits them to a fetch. Both start blank; "Apply" is
  // disabled until both are filled in, since the server rejects either
  // alone anyway (see `revenueSummaryQuerySchema`).
  const [fromDateInput, setFromDateInput] = useState("");
  const [toDateInput, setToDateInput] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);
  const [appliedFilter, setAppliedFilter] = useState<{ fromDate: string; toDate: string } | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    fetchRevenueSummary(undefined, appliedFilter ?? undefined)
      .then(setSummary)
      .catch(() => setLoadError(true));
  }, [appliedFilter]);

  useEffect(load, [load]);

  function handleApplyFilter() {
    if (toDateInput < fromDateInput) {
      setFilterError("The end date can't be before the start date.");
      return;
    }
    setFilterError(null);
    setAppliedFilter({ fromDate: fromDateInput, toDate: toDateInput });
  }

  function handleClearFilter() {
    setFilterError(null);
    setAppliedFilter(null);
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load revenue data.{" "}
        <button onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!summary) return <p className="text-ink-900/60">Loading...</p>;

  const trendData = summary.trend.map((t) => ({
    period: t.period,
    Earned: t.earnedCents / 100,
    Pending: t.pendingCents / 100,
  }));

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Revenue</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-brand-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-900/50">Earned revenue</p>
          <p className="mt-1 text-2xl font-semibold text-brand-700">{formatCents(summary.totalEarnedRevenueCents)}</p>
          <p className="mt-1 text-xs text-ink-900/50">Confirmed, shipped, and delivered orders</p>
          <Link
            to="/admin/orders?status=EARNED"
            className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline"
          >
            View orders &rarr;
          </Link>
        </div>
        <div className="rounded-xl border border-brand-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-900/50">Pending revenue</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">{formatCents(summary.totalPendingRevenueCents)}</p>
          <p className="mt-1 text-xs text-ink-900/50">Orders still awaiting confirmation</p>
          <Link
            to="/admin/orders?status=PENDING"
            className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline"
          >
            View orders &rarr;
          </Link>
        </div>
      </div>

      <h2 className="mt-8 font-serif text-xl text-ink-900">Revenue trend</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-brand-200 bg-white p-4">
        <label className="text-xs text-ink-900/60">
          From
          <input
            type="date"
            value={fromDateInput}
            onChange={(e) => setFromDateInput(e.target.value)}
            aria-label="From date"
            className="mt-1 block rounded-lg border border-brand-300 px-3 py-2 text-sm text-ink-900"
          />
        </label>
        <label className="text-xs text-ink-900/60">
          To
          <input
            type="date"
            value={toDateInput}
            onChange={(e) => setToDateInput(e.target.value)}
            aria-label="To date"
            className="mt-1 block rounded-lg border border-brand-300 px-3 py-2 text-sm text-ink-900"
          />
        </label>
        <button
          onClick={handleApplyFilter}
          disabled={!fromDateInput || !toDateInput}
          className="rounded-full bg-brand-600 px-5 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-40"
        >
          Apply
        </button>
        {appliedFilter && (
          <button
            onClick={handleClearFilter}
            className="rounded-full border border-brand-300 px-5 py-2 text-sm text-ink-900/70 hover:bg-brand-50"
          >
            Clear filter
          </button>
        )}
      </div>

      {filterError && <p className="mt-2 text-sm text-red-600">{filterError}</p>}

      {summary.filteredRange && (
        <p className="mt-3 text-sm text-ink-900/70">
          Showing:{" "}
          <span className="font-medium text-ink-900">
            {formatDate(summary.filteredRange.fromDate)} &ndash; {formatDate(summary.filteredRange.toDate)}
          </span>
        </p>
      )}

      <div className="mt-3 h-72 rounded-xl border border-brand-200 bg-white p-4" data-testid="revenue-trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(value: number) => `$${value}`} />
            <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
            <Legend />
            <Line type="monotone" dataKey="Earned" stroke="#15803d" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Pending" stroke="#b45309" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2 className="mt-8 font-serif text-xl text-ink-900">Revenue by category</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-brand-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-brand-100/60 text-left text-ink-900/60">
            <tr>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Earned</th>
              <th className="px-4 py-2">Pending</th>
            </tr>
          </thead>
          <tbody>
            {summary.revenueByCategory.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-ink-900/50">
                  No revenue yet.
                </td>
              </tr>
            )}
            {summary.revenueByCategory.map((row) => (
              <tr key={`${row.productType}-${row.category}`} className="border-t border-brand-100">
                <td className="px-4 py-2">{row.category}</td>
                <td className="px-4 py-2">{row.productType}</td>
                <td className="px-4 py-2">{formatCents(row.earnedCents)}</td>
                <td className="px-4 py-2">{formatCents(row.pendingCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
