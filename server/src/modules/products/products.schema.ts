import { z } from "zod";

/** Validation schemas and enums for the product catalog endpoints. */

// JEWELRY categories (worn pieces) vs BULLION categories (bars/coins bought
// for their metal content) - see `PRODUCT_TYPES`.
export const CATEGORIES = ["RING", "NECKLACE", "BRACELET", "EARRING", "BAR", "COIN"] as const;
export const METAL_TYPES = ["GOLD", "SILVER"] as const;
export const PRODUCT_TYPES = ["JEWELRY", "BULLION"] as const;
export const SORT_FIELDS = ["price", "weight"] as const;
export const SORT_ORDERS = ["asc", "desc"] as const;

/** Query params accepted by the product listing endpoint (filters, sorting + pagination). */
export const productListQuerySchema = z.object({
  productType: z.enum(PRODUCT_TYPES).optional(),
  category: z.enum(CATEGORIES).optional(),
  metalType: z.enum(METAL_TYPES).optional(),
  weightGrams: z.coerce.number().gt(0).optional(),
  minPriceCents: z.coerce.number().int().min(0).optional(),
  maxPriceCents: z.coerce.number().int().min(0).optional(),
  search: z.string().optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(SORT_ORDERS).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  includeInactive: z.coerce.boolean().default(false),
});

/** Request body schema for bulk-activating/deactivating products (admin only). */
export const bulkUpdateActiveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  isActive: z.boolean(),
});

/** Request body schema for bulk-deleting products (admin only). */
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

/** Request body schema for creating a product. */
export const createProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  productType: z.enum(PRODUCT_TYPES).default("JEWELRY"),
  category: z.enum(CATEGORIES),
  metalType: z.enum(METAL_TYPES),
  purity: z.number().gt(0).lte(1),
  weightGrams: z.number().gt(0),
  makingChargeCents: z.number().int().min(0).default(0),
  stockQuantity: z.number().int().min(0).default(0),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true),
});

/** Request body schema for updating a product; all fields optional. */
export const updateProductSchema = createProductSchema.partial();

/** Validates a route `:id` path param. */
export const idParamSchema = z.object({ id: z.string().min(1) });
