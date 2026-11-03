import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchUser, fetchUserOrderHistory } from "../../api/admin";
import { formatCents } from "../../lib/format";
import type { Order, User } from "../../types";

/**
 * One customer's full order history - split out of `AdminUserDetail.tsx`
 * into its own page (reached via the "View order history" button on that
 * page's "Last order" stat card) so the user-detail page can stay a
 * scannable stats-plus-profile view rather than growing an unbounded order
 * table inline. Uses the same `fetchUserOrderHistory()` wrapper the old
 * inline section already used - only where it's rendered changed.
 */
export function AdminUserOrders() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  function load() {
    if (!id) return;
    setLoadError(false);
    Promise.all([fetchUser(id), fetchUserOrderHistory(id)])
      .then(([u, o]) => {
        setUser(u);
        setOrders(o);
      })
      .catch(() => setLoadError(true));
  }

  useEffect(load, [id]);

  if (loadError) {
    return (
      <div className="max-w-3xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load order history.{" "}
        <button onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!user || !orders) return <p className="text-ink-900/60">Loading...</p>;

  return (
    <div className="max-w-3xl">
      <Link to={`/admin/users/${id}`} className="text-sm text-brand-600 hover:underline">
        &larr; Back to {user.name}
      </Link>

      <h1 className="mt-4 font-serif text-2xl text-ink-900 sm:text-3xl">Order history &middot; {user.name}</h1>

      {orders.length === 0 ? (
        <p className="mt-6 text-sm text-ink-900/60">This user hasn't placed any orders.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-brand-100">
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
              {orders.map((order) => (
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
      )}
    </div>
  );
}
