import { api } from "../lib/api";
import type { Product } from "../types";

/** API wrappers for the current user's wishlist. */

/** Fetches the caller's wishlisted products. */
export async function fetchWishlist() {
  const { data } = await api.get<{ products: Product[] }>("/wishlist");
  return data.products;
}

/** Adds a product to the caller's wishlist (idempotent). */
export async function addToWishlist(productId: string) {
  await api.post("/wishlist", { productId });
}

/** Removes a product from the caller's wishlist (idempotent). */
export async function removeFromWishlist(productId: string) {
  await api.delete(`/wishlist/${productId}`);
}
