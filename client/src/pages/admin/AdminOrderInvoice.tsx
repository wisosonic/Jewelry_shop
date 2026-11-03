import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchOrder } from "../../api/orders";
import { formatCents, formatCentsPerTroyOunce, formatSignedCommissionPerTroyOunce } from "../../lib/format";
import type { Order } from "../../types";

/**
 * Minimal, print-ready single-order invoice for the admin "Print invoice"
 * button on `AdminOrders.tsx`. Deliberately a **top-level route, not nested
 * under `/admin`** (see `App.tsx`) - it renders with no `AdminLayout`
 * sidebar/topbar chrome at all, so printing it prints only the invoice
 * itself, mirroring the customer-facing `OrderDetail.tsx`'s own
 * `window.print()` + `print:hidden` pattern without needing to touch
 * `AdminLayout.tsx` to hide its chrome. `fetchOrder()` already works for an
 * admin caller on any order server-side (`orders.service.ts`'s `getOrder()`
 * has no ownership restriction for `role === "ADMIN"`) - only the
 * customer-facing `/orders/:id` route is blocked for admins
 * (`excludeRole="ADMIN"` in `App.tsx`), which this separate route sidesteps.
 * Admin screens use `formatCents` directly rather than `useDisplayPrice`
 * (see the LBP-display-only domain invariant in `CLAUDE.md`).
 */
export function AdminOrderInvoice() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState(false);

  function load() {
    if (!id) return;
    setError(false);
    fetchOrder(id)
      .then(setOrder)
      .catch(() => setError(true));
  }

  useEffect(load, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <p className="text-ink-900/70">
          Couldn't load this order.{" "}
          <button onClick={load} className="font-medium underline">
            Try again
          </button>
        </p>
        <Link to="/admin/orders" className="mt-4 inline-block text-brand-600 hover:underline">
          &larr; Back to orders
        </Link>
      </div>
    );
  }

  if (!order) return <p className="p-8 text-ink-900/60">Loading...</p>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/admin/orders" className="text-sm text-brand-600 hover:underline">
          &larr; Back to orders
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-ink-900/80 hover:bg-brand-50"
        >
          Print
        </button>
      </div>

      <h1 className="mt-4 font-serif text-3xl text-ink-900 sm:text-4xl">Invoice #{order.id.slice(-8)}</h1>
      <p className="mt-1 text-sm text-ink-900/60">Placed {new Date(order.createdAt).toLocaleString()}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-brand-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-900/50">Customer</p>
          <p className="mt-1 text-sm text-ink-900/80">
            {order.user ? <>{order.user.name} &middot; {order.user.email}</> : "Deleted user"}
          </p>
        </div>
        <div className="rounded-xl border border-brand-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-900/50">Shipping address</p>
          <p className="mt-1 text-sm text-ink-900/80">{order.shippingAddress || "Not provided"}</p>
        </div>
      </div>

      <h2 className="mt-8 font-serif text-xl text-ink-900">Items</h2>
      <div className="mt-4 space-y-3">
        {order.items.map((item) => (
          <div key={item.id} className="rounded-xl border border-brand-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-ink-900">
                {item.productNameSnapshot} &times; {item.quantity}
              </span>
              <span className="font-semibold text-brand-700">
                {formatCents(item.lineTotalCents, order.currency)}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs text-ink-900/60 sm:grid-cols-4">
              <dt>SKU</dt>
              <dd className="text-ink-900/80">{item.skuSnapshot}</dd>
              <dt>Unit price</dt>
              <dd className="text-ink-900/80">{formatCents(item.unitPriceCentsSnapshot, order.currency)}</dd>
              <dt>Metal price (per troy oz)</dt>
              <dd className="text-ink-900/80">
                {formatCentsPerTroyOunce(item.metalPricePerGramCentsSnapshot, order.currency)}
              </dd>
              <dt>Commission (per troy oz)</dt>
              <dd className="font-medium text-green-600">
                {formatSignedCommissionPerTroyOunce(item.commissionCentsPerTroyOunceSnapshot, order.currency)}
              </dd>
            </dl>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-brand-200 pt-4">
        <span className="text-lg font-semibold text-ink-900">Total</span>
        <span className="text-lg font-semibold text-brand-700">{formatCents(order.totalCents, order.currency)}</span>
      </div>
    </div>
  );
}
