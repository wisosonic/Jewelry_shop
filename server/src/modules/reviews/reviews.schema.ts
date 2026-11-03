import { z } from "zod";

/** Validation schemas for per-product review endpoints. */

/** Validates the `:productId` path param this router is mounted under (`/products/:productId/reviews`). */
export const productIdParamSchema = z.object({ productId: z.string().min(1) });

/** Request body schema for creating/updating the caller's review of a product. */
export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
