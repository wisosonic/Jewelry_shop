import type { Category, ProductType } from "../types";

/** Category options valid for each product type, so a dropdown never offers a mismatched pair - shared by `AdminProductForm.tsx` and `AdminProducts.tsx`. */
export const CATEGORIES_BY_TYPE: Record<ProductType, Category[]> = {
  JEWELRY: ["RING", "NECKLACE", "BRACELET", "EARRING"],
  BULLION: ["BAR", "COIN"],
};
