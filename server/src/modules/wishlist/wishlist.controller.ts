import { Request, Response } from "express";
import * as wishlistService from "./wishlist.service";

/** HTTP handlers for viewing and managing the current user's wishlist. */

/** Lists the current user's wishlisted products. */
export async function list(req: Request, res: Response) {
  res.json({ products: await wishlistService.listWishlist(req.user!.id) });
}

/** Adds a product to the current user's wishlist (not available to ADMIN-role accounts - see `addToWishlist()`). */
export async function add(req: Request, res: Response) {
  await wishlistService.addToWishlist(req.user!.id, req.body.productId, req.user!.role);
  res.status(204).send();
}

/** Removes a product from the current user's wishlist. */
export async function remove(req: Request, res: Response) {
  await wishlistService.removeFromWishlist(req.user!.id, req.params.productId);
  res.status(204).send();
}
