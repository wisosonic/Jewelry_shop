import { z } from "zod";

/** Validation schemas for wishlist endpoints. */

/** Request body schema for adding a product to the wishlist. */
export const addWishlistItemSchema = z.object({
  productId: z.string().min(1),
});

/** Validates a route `:productId` path param. */
export const productIdParamSchema = z.object({ productId: z.string().min(1) });
