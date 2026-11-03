import { Router } from "express";
import { authenticate, authorize, optionalAuthenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./products.controller";
import {
  bulkDeleteSchema,
  bulkUpdateActiveSchema,
  createProductSchema,
  idParamSchema,
  productListQuerySchema,
  updateProductSchema,
} from "./products.schema";

/** Routes for browsing products (public) and managing the catalog (admin only). */
export const productsRouter = Router();

// `optionalAuthenticate` (not `authenticate`) - this route stays open to
// anonymous browsing, but `controller.list` needs to know whether the
// caller is a recognized admin before it's allowed to honor `includeInactive`
// (see products.service.ts's `listProducts()`).
productsRouter.get(
  "/",
  optionalAuthenticate,
  validate({ query: productListQuerySchema }),
  asyncHandler(controller.list)
);

productsRouter.patch(
  "/bulk-status",
  authenticate,
  authorize("ADMIN"),
  validate({ body: bulkUpdateActiveSchema }),
  asyncHandler(controller.bulkSetActive)
);
productsRouter.post(
  "/bulk-delete",
  authenticate,
  authorize("ADMIN"),
  validate({ body: bulkDeleteSchema }),
  asyncHandler(controller.bulkDelete)
);

productsRouter.get("/:id", validate({ params: idParamSchema }), asyncHandler(controller.get));
productsRouter.get(
  "/:id/related",
  validate({ params: idParamSchema }),
  asyncHandler(controller.related)
);

productsRouter.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate({ body: createProductSchema }),
  asyncHandler(controller.create)
);
productsRouter.patch(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate({ params: idParamSchema, body: updateProductSchema }),
  asyncHandler(controller.update)
);
productsRouter.delete(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove)
);
