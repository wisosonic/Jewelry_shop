import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./orders.controller";
import {
  bulkDeleteOrdersSchema,
  bulkUpdateOrderStatusSchema,
  createOrderSchema,
  idParamSchema,
  listOrdersQuerySchema,
  updateOrderAdminFieldsSchema,
} from "./orders.schema";

/** Routes for placing and viewing orders; all require authentication. */
export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.post("/", validate({ body: createOrderSchema }), asyncHandler(controller.create));
ordersRouter.get("/", validate({ query: listOrdersQuerySchema }), asyncHandler(controller.list));
ordersRouter.patch(
  "/bulk-status",
  authorize("ADMIN"),
  validate({ body: bulkUpdateOrderStatusSchema }),
  asyncHandler(controller.bulkUpdateStatus)
);
// Both registered above the generic `/:id` routes below, same as
// `/bulk-status` - Express matches in registration order, so `/bulk-delete`
// and `/all` would otherwise be swallowed by `DELETE /:id` with
// `id = "bulk-delete"`/`id = "all"`.
ordersRouter.post(
  "/bulk-delete",
  authorize("ADMIN"),
  validate({ body: bulkDeleteOrdersSchema }),
  asyncHandler(controller.bulkDelete)
);
ordersRouter.delete("/all", authorize("ADMIN"), asyncHandler(controller.deleteAll));
ordersRouter.get("/:id", validate({ params: idParamSchema }), asyncHandler(controller.get));
ordersRouter.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParamSchema, body: updateOrderAdminFieldsSchema }),
  asyncHandler(controller.updateAdminFields)
);
ordersRouter.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove)
);
ordersRouter.patch(
  "/:id/cancel",
  validate({ params: idParamSchema }),
  asyncHandler(controller.cancel)
);
ordersRouter.post(
  "/:id/resend-invoice",
  authorize("ADMIN"),
  validate({ params: idParamSchema }),
  asyncHandler(controller.resendInvoice)
);
