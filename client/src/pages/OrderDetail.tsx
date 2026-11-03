import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cancelOrder, fetchOrder } from "../api/orders";
import { OrderStatusTimeline } from "../components/common/OrderStatusTimeline";
import { OrderDetailSkeleton } from "../components/common/Skeleton";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useDisplayPrice } from "../hooks/useDisplayPrice";
import { formatCentsPerTroyOunce, formatSignedCommissionPerTroyOunce } from "../lib/format";
import type { Order } from "../types";

const CANCELLABLE_STATUSES = new Set(["PENDING", "CONFIRMED"]);

/**
 * Single order's full detail view: status, shipping/payment info, and a
 * line-item breakdown that includes the gold/silver price and commission
 * surcharge that were locked in at purchase time - a permanent record of
 * what the metal was worth when the customer bought it, independent of
 * where live prices are today. The server enforces that only the order's
 * owner or an admin can view it (this fetch 403s/404s otherwise).
 *
 * Note: the per-troy-ounce metal price and commission snapshot figures below
 * are deliberately left in USD (via formatCentsPerTroyOunce /
 * formatSignedCommissionPerTroyOunce) rather than converted to the shopper's
 * chosen display currency - there's no LBP-aware equivalent of those two
 * helpers, and inlining a real per-troy-ounce LBP conversion here would go
 * beyond a simple render-time swap. Every other price on this page (unit
 * price, line totals, order total) uses useDisplayPrice.
 */
export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const { showToast } = useToast();
  const formatPrice = useDisplayPrice();

  useEffect(() => {
    if (!id) return;
    fetchOrder(id)
      .then(setOrder)
      .catch(() => setError("This order could not be found, or you don't have access to it."));
  }, [id]);

  async function handleCancel() {
    if (!order) return;
    const ok = await confirm("Cancel this order? Stock will be restored.", {
      title: "Cancel order",
      confirmLabel: "Cancel order",
      danger: true,
    });
    if (!ok) return;

    try {
      const updated = await cancelOrder(order.id);
      setOrder(updated);
      showToast("Order cancelled.");
    } catch {
      showToast("Could not cancel this order.", "error");
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <p className="text-ink-900/70">{error}</p>
        <Link to="/orders" className="mt-4 inline-block text-brand-600 hover:underline">
          Back to order history
        </Link>
      </div>
    );
  }

  if (!order) return <OrderDetailSkeleton />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link to="/orders" className="text-sm text-brand-600 hover:underline print:hidden">
        &larr; Back to order history
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Order #{order.id.slice(-8)}</h1>
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-ink-900/80 hover:bg-brand-50 print:hidden"
        >
          Print invoice
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-900/60">Placed {new Date(order.createdAt).toLocaleString()}</p>

      <div className="mt-4 max-w-xs">
        <OrderStatusTimeline status={order.status} />
      </div>

      {CANCELLABLE_STATUSES.has(order.status) && (
        <button
          onClick={handleCancel}
          className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 print:hidden"
        >
          Cancel order
        </button>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-brand-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-900/50">Shipping address</p>
          <p className="mt-1 text-sm text-ink-900/80">{order.shippingAddress || "Not provided"}</p>
        </div>
        <div className="rounded-xl border border-brand-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-ink-900/50">Payment</p>
          <p className="mt-1 text-sm text-ink-900/80">{order.paymentStatus ?? "DEFERRED"}</p>
        </div>
      </div>

      <h2 className="mt-8 font-serif text-xl text-ink-900">Items</h2>
      <p className="mt-1 text-sm text-ink-900/60">
        The gold/silver price and commission shown below are locked in from the moment this
        order was placed - they won't change even if today's rates are different.
      </p>

      <div className="mt-4 space-y-3">
        {order.items.map((item) => (
          <div key={item.id} className="rounded-xl border border-brand-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-ink-900">
                {item.productNameSnapshot} &times; {item.quantity}
              </span>
              <span className="font-semibold text-brand-700">
                {formatPrice(item.lineTotalCents)}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs text-ink-900/60 sm:grid-cols-4">
              <dt>SKU</dt>
              <dd className="text-ink-900/80">{item.skuSnapshot}</dd>
              <dt>Unit price</dt>
              <dd className="text-ink-900/80">{formatPrice(item.unitPriceCentsSnapshot)}</dd>
              <dt>Metal price (per troy oz)</dt>
              <dd className="text-ink-900/80">
                {formatCentsPerTroyOunce(item.metalPricePerGramCentsSnapshot)}
              </dd>
              <dt>Commission (per troy oz)</dt>
              <dd className="font-medium text-green-600">
                {formatSignedCommissionPerTroyOunce(item.commissionCentsPerTroyOunceSnapshot)}
              </dd>
            </dl>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-brand-200 pt-4">
        <span className="text-lg font-semibold text-ink-900">Total</span>
        <span className="text-lg font-semibold text-brand-700">
          {formatPrice(order.totalCents)}
        </span>
      </div>
    </div>
  );
}
