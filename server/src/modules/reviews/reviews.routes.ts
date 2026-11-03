import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./reviews.controller";
import { createReviewSchema, productIdParamSchema } from "./reviews.schema";

/**
 * Routes for a single product's reviews. Mounted in app.ts at
 * `/products/:productId/reviews` - `mergeParams: true` is required for
 * this router's own handlers to see that parent `:productId`, since Express
 * routers don't inherit the parent path's params by default.
 */
export const reviewsRouter = Router({ mergeParams: true });

reviewsRouter.get("/", validate({ params: productIdParamSchema }), asyncHandler(controller.list));
reviewsRouter.post(
  "/",
  authenticate,
  validate({ params: productIdParamSchema, body: createReviewSchema }),
  asyncHandler(controller.upsert)
);
reviewsRouter.delete(
  "/",
  authenticate,
  validate({ params: productIdParamSchema }),
  asyncHandler(controller.remove)
);
