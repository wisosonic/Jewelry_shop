import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./wishlist.controller";
import { addWishlistItemSchema, productIdParamSchema } from "./wishlist.schema";

/** Routes for the current user's wishlist; all require authentication (a wishlist is always the caller's own). */
export const wishlistRouter = Router();
wishlistRouter.use(authenticate);

wishlistRouter.get("/", asyncHandler(controller.list));
wishlistRouter.post("/", validate({ body: addWishlistItemSchema }), asyncHandler(controller.add));
wishlistRouter.delete(
  "/:productId",
  validate({ params: productIdParamSchema }),
  asyncHandler(controller.remove)
);
