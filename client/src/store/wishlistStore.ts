import { create } from "zustand";
import { addToWishlist, fetchWishlist, removeFromWishlist } from "../api/wishlist";

type WishlistState = {
  /** The signed-in user's wishlisted product ids, hydrated from the server on login (see `AuthContext.tsx`). */
  productIds: Set<string>;
  load: () => Promise<void>;
  toggle: (productId: string) => Promise<void>;
  clear: () => void;
};

/**
 * Not persisted to localStorage (unlike `cartStore`) - a wishlist is
 * server-backed per user, so it's hydrated via `load()` on sign-in/silent
 * refresh and cleared on sign-out (both wired from `AuthContext.tsx`),
 * rather than surviving in the browser across accounts.
 */
export const useWishlistStore = create<WishlistState>((set, get) => ({
  productIds: new Set(),
  // Swallows its own failure since every call site (`AuthContext.tsx`'s
  // login/register/silent-refresh) calls this without awaiting or catching
  // it - a rejected promise here would otherwise be a genuine unhandled
  // rejection; the wishlist just stays empty until the next successful load
  // (e.g. visiting /wishlist directly) rather than the page breaking.
  load: async () => {
    try {
      const products = await fetchWishlist();
      set({ productIds: new Set(products.map((p) => p.id)) });
    } catch {
      console.error("Failed to load wishlist");
    }
  },
  toggle: async (productId) => {
    const alreadyWishlisted = get().productIds.has(productId);
    if (alreadyWishlisted) {
      await removeFromWishlist(productId);
    } else {
      await addToWishlist(productId);
    }
    set((state) => {
      const next = new Set(state.productIds);
      if (alreadyWishlisted) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return { productIds: next };
    });
  },
  clear: () => set({ productIds: new Set() }),
}));
