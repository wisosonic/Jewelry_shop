import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchProducts } from "../api/products";
import { QuantityStepper } from "../components/common/QuantityStepper";
import { CartIcon, TrashIcon } from "../components/icons/Icon";
import { ProductCard } from "../components/product/ProductCard";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useDisplayPrice } from "../hooks/useDisplayPrice";
import { useSyncCartWithCatalog } from "../hooks/useSyncCartWithCatalog";
import { useCartStore } from "../store/cartStore";
import type { Product } from "../types";

/** Shopping cart page: lists cart lines with editable quantities, shows the running total, cross-sells a few other products, and links to checkout. */
export function Cart() {
  const { lines, updateQuantity, removeItem } = useCartStore();
  const navigate = useNavigate();
  const formatPrice = useDisplayPrice();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [crossSell, setCrossSell] = useState<Product[]>([]);
  const total = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);

  // Reconciles stale prices/stock against the live catalog - see the
  // hook's own doc comment for why this can't just be trusted from
  // add-to-cart time.
  useSyncCartWithCatalog();

  useEffect(() => {
    const cartProductIds = new Set(lines.map((l) => l.productId));
    fetchProducts({ pageSize: 8 })
      .then((res) => setCrossSell(res.items.filter((p) => !cartProductIds.has(p.id)).slice(0, 4)))
      .catch(() => setCrossSell([]));
    // Only refetch when the cart's contents actually change (line count/ids), not on every quantity tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.map((l) => l.productId).join(",")]);

  /** Confirms with the shopper, then removes the line. */
  async function handleRemove(productId: string, name: string) {
    const confirmed = await confirm(`Remove "${name}" from your cart?`, { confirmLabel: "Remove", danger: true });
    if (!confirmed) return;
    removeItem(productId);
    showToast("Removed from cart.");
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <CartIcon className="mx-auto h-10 w-10 text-brand-300" />
        <h1 className="mt-3 font-serif text-2xl text-ink-900">Your cart is empty</h1>
        <Link to="/shop" className="mt-4 inline-block text-brand-600 hover:underline">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="flex items-center gap-2 font-serif text-3xl text-ink-900 sm:text-4xl">
        <CartIcon className="h-7 w-7" /> Your cart
      </h1>

      <ul className="mt-6 divide-y divide-brand-200">
        {lines.map((line) => (
          <li key={line.productId} className="flex flex-wrap items-center gap-4 py-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-100">
              {line.imageUrl && (
                <img
                  src={line.imageUrl}
                  alt={line.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="min-w-[160px] flex-1">
              <p className="truncate font-medium text-ink-900">{line.name}</p>
              <p className="text-sm text-ink-900/60">{formatPrice(line.unitPriceCents)} each</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-4">
              <QuantityStepper
                value={line.quantity}
                max={line.stockQuantity}
                onChange={(quantity) => updateQuantity(line.productId, quantity)}
              />
              <p className="w-24 text-right font-medium text-ink-900">
                {formatPrice(line.unitPriceCents * line.quantity)}
              </p>
              <button
                onClick={() => handleRemove(line.productId, line.name)}
                className="flex items-center gap-1.5 rounded px-2 py-2 text-sm text-red-600 hover:bg-red-50 hover:underline"
              >
                <TrashIcon className="h-4 w-4" /> Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between border-t border-brand-200 pt-6">
        <span className="text-lg font-semibold text-ink-900">Total</span>
        <span className="text-lg font-semibold text-brand-700" aria-live="polite">
          {formatPrice(total)}
        </span>
      </div>

      <button
        onClick={() => navigate("/checkout")}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 py-3 text-white hover:bg-brand-700"
      >
        <CartIcon className="h-5 w-5" /> Proceed to checkout
      </button>

      {crossSell.length > 0 && (
        <section className="mt-16 border-t border-brand-200 pt-10">
          <h2 className="font-serif text-xl text-ink-900">You might also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {crossSell.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
