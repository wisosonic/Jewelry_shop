import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Product } from "../types";

export type CartLine = {
  productId: string;
  name: string;
  sku: string;
  imageUrl?: string | null;
  unitPriceCents: number;
  quantity: number;
  stockQuantity: number;
};

type CartState = {
  lines: CartLine[];
  addItem: (product: Product, quantity?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateLine: (productId: string, patch: Partial<Pick<CartLine, "unitPriceCents" | "stockQuantity" | "quantity">>) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
};

/**
 * Zustand store for the shopping cart. Persisted to localStorage (key
 * `naya-sofia-cart`) so the cart survives page reloads and browser restarts.
 * Line quantities are always clamped to the product's stock at add/update time.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      addItem: (product, quantity = 1) => {
        const existing = get().lines.find((line) => line.productId === product.id);
        const maxQty = product.stockQuantity;
        if (existing) {
          set({
            lines: get().lines.map((line) =>
              line.productId === product.id
                ? { ...line, quantity: Math.min(line.quantity + quantity, maxQty) }
                : line
            ),
          });
        } else {
          set({
            lines: [
              ...get().lines,
              {
                productId: product.id,
                name: product.name,
                sku: product.sku,
                imageUrl: product.imageUrl,
                unitPriceCents: product.currentPriceCents,
                quantity: Math.min(quantity, maxQty),
                stockQuantity: maxQty,
              },
            ],
          });
        }
      },
      updateQuantity: (productId, quantity) =>
        set({
          lines: get()
            .lines.map((line) => (line.productId === productId ? { ...line, quantity } : line))
            .filter((line) => line.quantity > 0),
        }),
      // General-purpose patch, used by useSyncCartWithCatalog.ts to write
      // back a line's live price/stock (and a stock-clamped quantity) in
      // one update - unlike updateQuantity, which only ever touches
      // quantity. Shares the same "drop the line once its quantity hits 0"
      // behavior, since a clamped-to-zero-stock item should disappear the
      // same way removing the last unit manually already does.
      updateLine: (productId, patch) =>
        set({
          lines: get()
            .lines.map((line) => (line.productId === productId ? { ...line, ...patch } : line))
            .filter((line) => line.quantity > 0),
        }),
      removeItem: (productId) => set({ lines: get().lines.filter((line) => line.productId !== productId) }),
      clear: () => set({ lines: [] }),
    }),
    { name: "naya-sofia-cart" }
  )
);
