import { api } from "../lib/api";
import type { Category, MetalType, Product, ProductType } from "../types";

/** API wrappers for browsing and managing the product catalog. */

/** Fetches a paginated, filterable, sortable list of products for the shop/admin listing pages. */
export async function fetchProducts(params: {
  productType?: ProductType;
  category?: Category;
  metalType?: MetalType;
  weightGrams?: number;
  minPriceCents?: number;
  maxPriceCents?: number;
  search?: string;
  sortBy?: "price" | "weight";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
}) {
  const { data } = await api.get<{ items: Product[]; total: number; page: number; pageSize: number }>(
    "/products",
    { params }
  );
  return data;
}

/** Fetches a single product by id. */
export async function fetchProduct(id: string) {
  const { data } = await api.get<{ product: Product }>(`/products/${id}`);
  return data.product;
}

/** Fetches a few other products in the same category, for a "you might also like" section. */
export async function fetchRelatedProducts(id: string) {
  const { data } = await api.get<{ products: Product[] }>(`/products/${id}/related`);
  return data.products;
}

/** Activates or deactivates several products at once (admin only). */
export async function bulkSetProductsActive(ids: string[], isActive: boolean) {
  await api.patch("/products/bulk-status", { ids, isActive });
}

/** Deletes several products at once (admin only). */
export async function bulkDeleteProducts(ids: string[]) {
  await api.post("/products/bulk-delete", { ids });
}

/** Fields an admin submits when creating/editing a product; price is always server-derived. */
export type ProductInput = Omit<Product, "id" | "currentPriceCents" | "createdAt" | "updatedAt">;

/** Creates a new product. */
export async function createProduct(input: ProductInput) {
  const { data } = await api.post<{ product: Product }>("/products", input);
  return data.product;
}

/** Updates an existing product with a partial set of fields. */
export async function updateProduct(id: string, input: Partial<ProductInput>) {
  const { data } = await api.patch<{ product: Product }>(`/products/${id}`, input);
  return data.product;
}

/** Deletes a product by id. */
export async function deleteProduct(id: string) {
  await api.delete(`/products/${id}`);
}

/** Uploads an image file for a product and returns its hosted URL. */
export async function uploadProductImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  const { data } = await api.post<{ url: string }>("/uploads/image", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
}
