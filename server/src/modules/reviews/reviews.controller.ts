import { Request, Response } from "express";
import * as reviewsService from "./reviews.service";

/** HTTP handlers for a product's reviews (nested under `/products/:productId/reviews`). */

/** Lists a product's reviews plus its average rating. */
export async function list(req: Request, res: Response) {
  res.json(await reviewsService.listReviews(req.params.productId));
}

/** Creates or updates the caller's own review for a product. */
export async function upsert(req: Request, res: Response) {
  const review = await reviewsService.upsertReview(req.params.productId, req.user!.id, req.body);
  res.status(201).json({ review });
}

/** Deletes the caller's own review for a product. */
export async function remove(req: Request, res: Response) {
  await reviewsService.deleteOwnReview(req.params.productId, req.user!.id);
  res.status(204).send();
}
