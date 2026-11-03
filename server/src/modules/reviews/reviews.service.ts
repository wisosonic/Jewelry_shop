import { prisma } from "../../db/prisma";
import { AppError } from "../../utils/AppError";

/**
 * Business logic for per-product reviews. One review per user per product
 * (`Review`'s `@@unique([userId, productId])`) - re-submitting edits the
 * existing review rather than creating a second one.
 */

/** Lists a product's reviews (most recent first) plus the aggregate average rating and count. */
export async function listReviews(productId: string) {
  const [reviews, aggregate] = await Promise.all([
    prisma.review.findMany({
      where: { productId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.review.aggregate({ where: { productId }, _avg: { rating: true }, _count: { _all: true } }),
  ]);

  return {
    reviews,
    averageRating: aggregate._avg.rating,
    reviewCount: aggregate._count._all,
  };
}

/**
 * Creates or updates the caller's review for a product.
 * @throws {AppError} 404 if the product doesn't exist.
 */
export async function upsertReview(
  productId: string,
  userId: string,
  input: { rating: number; comment?: string }
) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw AppError.notFound("Product not found");

  return prisma.review.upsert({
    where: { userId_productId: { userId, productId } },
    update: { rating: input.rating, comment: input.comment },
    create: { productId, userId, rating: input.rating, comment: input.comment },
    include: { user: { select: { id: true, name: true } } },
  });
}

/** Deletes the caller's own review for a product, if one exists. Idempotent. */
export async function deleteOwnReview(productId: string, userId: string): Promise<void> {
  await prisma.review.deleteMany({ where: { productId, userId } });
}
