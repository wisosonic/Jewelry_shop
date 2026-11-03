import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createOrder } from "../api/orders";
import { useAuth } from "../context/AuthContext";
import { useDisplayPrice } from "../hooks/useDisplayPrice";
import { useSyncCartWithCatalog } from "../hooks/useSyncCartWithCatalog";
import { useCartStore } from "../store/cartStore";

/** Checkout page: collects a shipping address, shows an order summary, and submits the cart as a new order. */
export function Checkout() {
  const { user } = useAuth();
  const { lines, clear } = useCartStore();
  const [shippingAddress, setShippingAddress] = useState(user?.address ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const formatPrice = useDisplayPrice();

  // Checkout can be reached directly (a bookmark, the back button) without
  // passing back through Cart.tsx first, so it re-validates independently -
  // see the hook's own doc comment.
  useSyncCartWithCatalog();

  const total = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const isUnverified = !!user && !user.isVerified;

  /**
   * Submits the cart as a new order and clears it on success, redirecting to
   * the new order's detail page. Prices are re-validated and snapshotted
   * server-side from the current product record - the amounts shown here
   * are for display only.
   */
  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    try {
      const order = await createOrder({
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        shippingAddress,
      });
      clear();
      navigate(`/orders/${order.id}`);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message ?? "Could not place order. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center sm:px-6">
        <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Checkout</h1>
        <p className="mt-4 text-ink-900/70">Your cart is empty.</p>
        <Link to="/shop" className="mt-6 inline-block rounded-full bg-brand-600 px-6 py-3 text-white hover:bg-brand-700">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl">Checkout</h1>

      <label htmlFor="shipping-address" className="mt-6 block text-sm font-medium text-ink-900">
        Shipping address
      </label>
      <textarea
        id="shipping-address"
        value={shippingAddress}
        onChange={(e) => setShippingAddress(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
      />

      <div className="mt-6 rounded-xl border border-brand-200 bg-white p-4">
        {lines.map((l) => (
          <div key={l.productId} className="flex flex-wrap justify-between gap-x-2 py-1 text-sm text-ink-900/80">
            <span>{l.name} &times; {l.quantity}</span>
            <span>{formatPrice(l.unitPriceCents * l.quantity)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-brand-200 pt-2 font-semibold text-ink-900">
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <p className="mt-4 text-sm text-ink-900/60">
        Payment integration is coming soon. Your order will be saved with a pending status,
        and we'll follow up to arrange payment and delivery.
      </p>

      {isUnverified && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Verify your phone number before placing an order.{" "}
          <Link to="/verify-otp" className="font-medium underline">
            Verify now
          </Link>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting || isUnverified}
        className="mt-6 w-full rounded-full bg-brand-600 py-3 text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {isSubmitting ? "Placing order..." : "Place order"}
      </button>
    </div>
  );
}
