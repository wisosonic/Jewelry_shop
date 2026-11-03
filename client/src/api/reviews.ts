import { api } from "../lib/api";
import type { ReviewSummary } from "../types";

/** API wrappers for a single product's reviews. */

/** Fetches a product's reviews along with its average rating and count. */
export async function fetchReviews(productId: string) {
  const { data } = await api.get<ReviewSummary>(`/products/${productId}/reviews`);
  return data;
}

/** Creates or updates the caller's own review for a product. */
export async function submitReview(productId: string, input: { rating: number; comment?: string }) {
  await api.post(`/products/${productId}/reviews`, input);
}

/** Deletes the caller's own review for a product. */
export async function deleteReview(productId: string) {
  await api.delete(`/products/${productId}/reviews`);
}
