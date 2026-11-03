import { useEffect } from "react";
import { fetchProduct } from "../api/products";
import { useToast } from "../context/ToastContext";
import { useCartStore } from "../store/cartStore";

/**
 * Re-fetches each cart line's live product on mount and reconciles the
 * cart against it. `cartStore` persists to localStorage indefinitely with
 * no expiry, and nothing else ever re-touches a line's `unitPriceCents`/
 * `stockQuantity` after add-to-cart time - so a shopper who adds an item
 * and comes back after the metal price (and therefore the product's price)
 * has changed would otherwise see a stale total all the way through
 * checkout, only to have the order actually charge at today's price
 * server-side (`orders.service.ts`'s `createOrder()` always reads the
 * product's current `currentPriceCents`, never trusts the cart). This
 * closes that gap on the display side: a price change is applied
 * silently (with a toast) rather than leaving the shopper to discover a
 * different total after placing the order, and an item that's been
 * deactivated or is now fully out of stock is removed, mirroring
 * `OrderHistory.tsx`'s "Reorder" button, which already re-validates the
 * same way. Used by both `Cart.tsx` and `Checkout.tsx` - either can be the
 * first page a shopper lands on in a given visit (e.g. a bookmark or the
 * back button), so both need to reconcile independently rather than
 * trusting the other already did.
 */
export function useSyncCartWithCatalog() {
  const lines = useCartStore((state) => state.lines);
  const updateLine = useCartStore((state) => state.updateLine);
  const removeItem = useCartStore((state) => state.removeItem);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      lines.map(async (line) => {
        try {
          return { productId: line.productId, product: await fetchProduct(line.productId) };
        } catch {
          return { productId: line.productId, product: null };
        }
      })
    ).then((results) => {
      if (cancelled) return;

      let removedCount = 0;
      let priceChangedCount = 0;
      let quantityReducedCount = 0;

      for (const { productId, product } of results) {
        // Re-read the line fresh at apply time rather than trusting the
        // snapshot captured when the fetch started - the shopper may have
        // changed its quantity, or removed it entirely, while this
        // (possibly slow) request was in flight, and applying a stale
        // quantity here would silently clobber that edit.
        const currentLine = useCartStore.getState().lines.find((l) => l.productId === productId);
        if (!currentLine) continue;

        if (!product || !product.isActive || product.stockQuantity <= 0) {
          removeItem(productId);
          removedCount++;
          continue;
        }

        if (product.currentPriceCents !== currentLine.unitPriceCents) priceChangedCount++;
        const quantity = Math.min(currentLine.quantity, product.stockQuantity);
        if (quantity !== currentLine.quantity) quantityReducedCount++;

        updateLine(productId, {
          unitPriceCents: product.currentPriceCents,
          stockQuantity: product.stockQuantity,
          quantity,
        });
      }

      if (removedCount > 0 && removedCount === results.length) {
        showToast("Everything in your cart is no longer available.", "error");
        return;
      }
      if (removedCount > 0) {
        showToast(`${removedCount} item(s) in your cart are no longer available and were removed.`, "error");
      }
      if (priceChangedCount > 0) {
        showToast(`Price${priceChangedCount > 1 ? "s" : ""} updated for ${priceChangedCount} item(s) to reflect current rates.`);
      }
      if (quantityReducedCount > 0) {
        showToast(`Quantity reduced for ${quantityReducedCount} item(s) due to limited stock.`);
      }
    });

    return () => {
      cancelled = true;
    };
    // Only re-sync when the set of products in the cart changes (matches
    // Cart.tsx's existing cross-sell effect) - not on every quantity edit,
    // which would otherwise re-fetch on every stepper click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.map((l) => l.productId).join(",")]);
}
