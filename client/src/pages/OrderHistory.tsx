import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProduct } from "../api/products";
import { cancelOrder, fetchMyOrders } from "../api/orders";
import { OrderStatusTimeline } from "../components/common/OrderStatusTimeline";
import { Pagination } from "../components/common/Pagination";
import { OrderListSkeleton } from "../components/common/Skeleton";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useDisplayPrice } from "../hooks/useDisplayPrice";
import { useCartStore } from "../store/cartStore";
import type { Order } from "../types";

const CANCELLABLE_STATUSES = new Set(["PENDING", "CONFIRMED"]);
const PAGE_SIZE = 10;

/** Standalone order history page for the logged-in customer, linked from the profile dropdown/page. */
export function OrderHistory() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const confirm = useConfirm();
  const { showToast } = useToast();
  const formatPrice = useDisplayPrice();
  const addItem = useCartStore((s) => s.addItem);

  const loadOrders = useCallback(() => {
    setLoadError(false);
    fetchMyOrders({ page, pageSize: PAGE_SIZE })
      .then((result) => {
        setOrders(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        setOrders([]);
        setLoadError(true);
      });
  }, [page]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  async function handleCancel(orderId: string) {
    const ok = await confirm("Cancel this order? Stock will be restored.", {
      title: "Cancel order",
      confirmLabel: "Cancel order",
      danger: true,
    });
    if (!ok) return;

    try {
      await cancelOrder(orderId);
      loadOrders();
      showToast("Order cancelled.");
    } catch {
      showToast("Could not cancel this order.", "error");
    }
  }

  /** Re-adds an order's items to the cart at today's prices/stock, skipping any product that's since been removed or deactivated. */
  async function handleReorder(order: Order) {
    const results = await Promise.allSettled(
      order.items.map(async (item) => {
        const product = await fetchProduct(item.productId);
        if (!product.isActive || product.stockQuantity <= 0) throw new Error("unavailable");
        addItem(product, Math.min(item.quantity, product.stockQuantity));
      })
    );
    const skipped = results.filter((r) => r.status === "rejected").length;
    if (skipped === order.items.length) {
      showToast("None of these items are available anymore.", "error");
    } else if (skipped > 0) {
      showToast(`Added to cart - ${skipped} item(s) are no longer available.`);
    } else {
      showToast("Added to cart.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link to="/profile" className="text-sm text-brand-600 hover:underline">
        &larr; Back to my account
      </Link>

      <h1 className="mt-4 font-serif text-3xl text-ink-900 sm:text-4xl">Order history</h1>

      {orders === null ? (
        <OrderListSkeleton />
      ) : loadError ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your orders.{" "}
          <button onClick={loadOrders} className="font-medium underline">
            Try again
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-6 text-ink-900/60">
          <p>You haven't placed any orders yet.</p>
          <Link to="/shop" className="mt-2 inline-block text-brand-600 hover:underline">
            Start shopping
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {orders.map((order) => (
              <li key={order.id} className="rounded-xl border border-brand-200 bg-white p-4 hover:border-brand-400">
                <Link to={`/orders/${order.id}`} className="block">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">Order #{order.id.slice(-8)}</span>
                    <span className="font-semibold text-brand-700">{formatPrice(order.totalCents)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-900/60">
                    {new Date(order.createdAt).toLocaleDateString()} &middot; {order.items.length} item(s)
                  </p>
                  <div className="mt-3 max-w-xs">
                    <OrderStatusTimeline status={order.status} />
                  </div>
                </Link>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleReorder(order)}
                    className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-ink-900/80 hover:bg-brand-50"
                  >
                    Reorder
                  </button>
                  {CANCELLABLE_STATUSES.has(order.status) && (
                    <button
                      onClick={() => handleCancel(order.id)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      Cancel order
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
