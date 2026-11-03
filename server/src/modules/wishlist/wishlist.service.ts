import { prisma } from "../../db/prisma";
import { AppError } from "../../utils/AppError";
import { isAdminRole } from "../../utils/roles";

/** Business logic for a user's wishlist: products saved for later. */

/** Lists the products a user has wishlisted, most recently added first. */
export async function listWishlist(userId: string) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { createdAt: "desc" },
  });
  return items.map((item) => item.product);
}

/**
 * Adds a product to a user's wishlist. Idempotent - adding a product
 * that's already wishlisted is a no-op rather than an error, since the
 * client's only affordance is a toggle (see `WishlistItem`'s
 * `@@unique([userId, productId])`).
 * @throws {AppError} 403 if the caller is an ADMIN-role account - the
 * wishlist is a shopping feature, not relevant to admin accounts (see the
 * `role` parameter's doc note), 404 if the product doesn't exist.
 */
export async function addToWishlist(userId: string, productId: string, role: string): Promise<void> {
  // Enforced here (not just hidden client-side, see `ProductCard.tsx`/
  // `ProductDetail.tsx`) so the restriction actually holds regardless of
  // how the request is made - `role` comes from the caller's own verified
  // JWT (`req.user!.role`), not a fresh DB lookup, since the controller
  // already has it for free.
  if (isAdminRole(role)) {
    throw AppError.forbidden("Admin accounts can't use the wishlist.");
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw AppError.notFound("Product not found");

  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    update: {},
    create: { userId, productId },
  });
}

/** Removes a product from a user's wishlist. Idempotent - removing something that isn't there is a no-op. */
export async function removeFromWishlist(userId: string, productId: string): Promise<void> {
  await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
}
