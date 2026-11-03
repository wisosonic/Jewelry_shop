import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDashboardSummary } from "../../api/admin";
import { TrendingUpIcon } from "../../components/icons/Icon";
import { MetalPricesPanel } from "../../components/metals/MetalPricesPanel";
import { formatCents } from "../../lib/format";
import type { DashboardSummary } from "../../types";

/** Admin landing page showing headline stats (revenue, products, users, pending orders) and a recent-orders table. */
export function AdminDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    fetchDashboardSummary()
      .then(setSummary)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load the dashboard.{" "}
        <button onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!summary) return <p className="text-ink-900/60">Loading...</p>;

  const stats = [
    { label: "Total revenue", value: formatCents(summary.totalRevenueCents) },
    { label: "Products", value: summary.productCount },
    { label: "Users", value: summary.userCount },
    { label: "Pending orders", value: summary.ordersByStatus.PENDING ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Dashboard</h1>

      <div className="mt-4">
        <MetalPricesPanel variant="compact" />
      </div>

      {summary.lowStockProducts.length > 0 && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-800">
            <TrendingUpIcon className="h-4 w-4 rotate-180" />
            <h2 className="font-medium">Low stock alert</h2>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {summary.lowStockProducts.map((product) => (
              <li key={product.id} className="flex items-center justify-between gap-3">
                <Link to={`/admin/products/${product.id}`} className="hover:underline">
                  {product.name} ({product.sku})
                </Link>
                <span className="font-medium">{product.stockQuantity} left</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-brand-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-900/50">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-brand-700">{s.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 font-serif text-xl text-ink-900">Recent orders</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-brand-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-brand-100/60 text-left text-ink-900/60">
            <tr>
              <th className="px-4 py-2">Order</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {summary.recentOrders.map((order) => (
              <tr key={order.id} className="border-t border-brand-100">
                <td className="px-4 py-2">
                  <Link to="/admin/orders" className="text-brand-600 hover:underline">
                    #{order.id.slice(-8)}
                  </Link>
                </td>
                <td className="px-4 py-2">{order.status}</td>
                <td className="px-4 py-2">{formatCents(order.totalCents, order.currency)}</td>
                <td className="px-4 py-2">{new Date(order.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
