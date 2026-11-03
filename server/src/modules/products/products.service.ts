import { prisma } from "../../db/prisma";
import { AppError } from "../../utils/AppError";
import { createNotification, notifyAdminsOfEvent } from "../notifications/inAppNotifications.service";
import { getSettings, sellingCommissionForMetal } from "../settings/settings.service";
import { isAdminRole } from "../../utils/roles";
import { computePriceCents } from "./pricing";
import { z } from "zod";
import { createProductSchema, productListQuerySchema, updateProductSchema } from "./products.schema";

/** Business logic for the product catalog: listing/filtering, CRUD, and price computation. */

/** Fetches the most recently fetched price record for a metal type. */
async function getLatestPriceForMetal(metalType: string) {
  return prisma.metalPrice.findFirst({
    where: { metalType },
    orderBy: { fetchedAt: "desc" },
  });
}

/** Prices a product input using the latest metal rate and the metal-specific selling commission (see `sellingCommissionForMetal()`). */
async function priceProductInput(input: {
  metalType: string;
  weightGrams: number;
  purity: number;
  makingChargeCents: number;
  productType: string;
}) {
  const [latest, settings] = await Promise.all([
    getLatestPriceForMetal(input.metalType),
    getSettings(),
  ]);
  const pricePerGramCents = latest?.pricePerGramCents ?? 0;
  return computePriceCents({
    pricePerGramCents,
    weightGrams: input.weightGrams,
    purity: input.purity,
    commissionCentsPerTroyOunce: sellingCommissionForMetal(settings, input.metalType),
    makingChargeCents: input.makingChargeCents,
    productType: input.productType === "BULLION" ? "BULLION" : "JEWELRY",
  });
}

/**
 * Attaches each product's aggregate average rating and review count via a
 * single `groupBy` query (not one `review.aggregate()` per product) - used
 * everywhere a list of products is rendered as `ProductCard`s, which show
 * a star rating/count for social proof.
 */
async function attachRatings<T extends { id: string }>(
  products: T[]
): Promise<(T & { averageRating: number | null; reviewCount: number })[]> {
  if (products.length === 0) return [];

  const aggregates = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: products.map((p) => p.id) } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const byProductId = new Map(aggregates.map((a) => [a.productId, a]));

  return products.map((product) => ({
    ...product,
    averageRating: byProductId.get(product.id)?._avg.rating ?? null,
    reviewCount: byProductId.get(product.id)?._count._all ?? 0,
  }));
}

/**
 * Lists products with optional type/category/metal/weight/search filters,
 * pagination, and sorting (by price or weight; defaults to newest first).
 * `includeInactive` is only ever honored when `viewerRole` is `"ADMIN"` -
 * this route is public (anonymous browsing), so an unauthenticated or
 * non-admin caller passing `includeInactive=true` is silently ignored
 * rather than actually exposing deactivated/hidden products, which would
 * otherwise be the only way this app hides a product from the storefront.
 */
export async function listProducts(query: z.infer<typeof productListQuerySchema>, viewerRole?: string) {
  const where: Record<string, unknown> = {};
  if (!query.includeInactive || !isAdminRole(viewerRole ?? "")) where.isActive = true;
  if (query.productType) where.productType = query.productType;
  if (query.category) where.category = query.category;
  if (query.metalType) where.metalType = query.metalType;
  if (query.weightGrams !== undefined) where.weightGrams = query.weightGrams;
  if (query.minPriceCents !== undefined || query.maxPriceCents !== undefined) {
    where.currentPriceCents = {
      ...(query.minPriceCents !== undefined ? { gte: query.minPriceCents } : {}),
      ...(query.maxPriceCents !== undefined ? { lte: query.maxPriceCents } : {}),
    };
  }
  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { description: { contains: query.search } },
    ];
  }

  const orderBy =
    query.sortBy === "price"
      ? { currentPriceCents: query.sortOrder }
      : query.sortBy === "weight"
        ? { weightGrams: query.sortOrder }
        : { createdAt: "desc" as const };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy,
    }),
    prisma.product.count({ where }),
  ]);

  return { items: await attachRatings(items), total, page: query.page, pageSize: query.pageSize };
}

/**
 * Fetches a single product by id.
 * @throws {AppError} 404 if no such product exists.
 */
export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw AppError.notFound("Product not found");
  return product;
}

/**
 * Returns a handful of other active products in the same category, for a
 * "you might also like" section on the product detail page.
 * @throws {AppError} 404 if the given product doesn't exist.
 */
export async function getRelatedProducts(productId: string, limit = 4) {
  const product = await getProduct(productId);
  const related = await prisma.product.findMany({
    where: { id: { not: productId }, isActive: true, category: product.category },
    take: limit,
    orderBy: { createdAt: "desc" },
  });
  return attachRatings(related);
}

/**
 * Creates a new product, computing its cached price from current metal
 * rates and commission settings.
 * @throws {AppError} 409 if the SKU is already in use.
 */
export async function createProduct(input: z.infer<typeof createProductSchema>) {
  const existing = await prisma.product.findUnique({ where: { sku: input.sku } });
  if (existing) throw AppError.conflict("A product with this SKU already exists");

  const currentPriceCents = await priceProductInput(input);
  return prisma.product.create({ data: { ...input, currentPriceCents } });
}

/** Updates a product's fields and recomputes its cached price from the merged result. */
export async function updateProduct(id: string, input: z.infer<typeof updateProductSchema>) {
  const existing = await getProduct(id);
  const merged = { ...existing, ...input };
  const currentPriceCents = await priceProductInput(merged);
  const updated = await prisma.product.update({ where: { id }, data: { ...input, currentPriceCents } });

  if (input.stockQuantity !== undefined) {
    await checkStockThresholds(updated.id, updated.name, existing.stockQuantity, input.stockQuantity);
  }

  return updated;
}

/**
 * Fires the low-stock admin alert or the wishlist back-in-stock notification
 * when a stock change crosses the relevant threshold - never on every
 * change while a product just *stays* low/in-stock, only at the moment it
 * crosses. Called from `updateProduct()` above (an admin editing stock
 * directly) and from `orders.service.ts` (stock decremented by a purchase,
 * incremented back by a cancellation) - centralized here rather than
 * duplicating the crossing-detection logic at three call sites.
 */
export async function checkStockThresholds(
  productId: string,
  productName: string,
  previousStock: number,
  newStock: number
): Promise<void> {
  const settings = await getSettings();

  if (previousStock > settings.lowStockThreshold && newStock <= settings.lowStockThreshold) {
    await notifyAdminsOfEvent("LOW_STOCK", {
      message: `${productName} is low on stock (${newStock} left).`,
      link: "/admin/products",
    });
  }

  if (previousStock <= 0 && newStock > 0) {
    const wishlisters = await prisma.wishlistItem.findMany({ where: { productId }, select: { userId: true } });
    for (const { userId } of wishlisters) {
      await createNotification({
        userId,
        type: "WISHLIST_BACK_IN_STOCK",
        message: `${productName} is back in stock.`,
        link: `/shop/${productId}`,
      });
    }
  }
}

/** Deletes a product by id. */
export async function deleteProduct(id: string) {
  await prisma.product.delete({ where: { id } });
}

/** Activates or deactivates several products at once (admin bulk action). */
export async function bulkSetActive(ids: string[], isActive: boolean) {
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { isActive } });
}

/** Deletes several products at once (admin bulk action). */
export async function bulkDeleteProducts(ids: string[]) {
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Recomputes every product's cached price from the latest metal prices and
 * current commission surcharges. Called after a metals price refresh or
 * after the commission changes in Settings. Each product uses its own
 * metal-specific selling commission (`sellingCommissionForMetal()`) - a
 * gold product is unaffected by a silver-only commission change, and vice
 * versa.
 */
export async function repriceAllProducts() {
  const [settings, products] = await Promise.all([
    getSettings(),
    prisma.product.findMany(),
  ]);

  const latestByMetal = new Map<string, number>();
  for (const metalType of ["GOLD", "SILVER"]) {
    const latest = await getLatestPriceForMetal(metalType);
    latestByMetal.set(metalType, latest?.pricePerGramCents ?? 0);
  }

  await prisma.$transaction(
    products.map((product) =>
      prisma.product.update({
        where: { id: product.id },
        data: {
          currentPriceCents: computePriceCents({
            pricePerGramCents: latestByMetal.get(product.metalType) ?? 0,
            weightGrams: product.weightGrams,
            purity: product.purity,
            commissionCentsPerTroyOunce: sellingCommissionForMetal(settings, product.metalType),
            makingChargeCents: product.makingChargeCents,
            productType: product.productType === "BULLION" ? "BULLION" : "JEWELRY",
          }),
        },
      })
    )
  );
}
