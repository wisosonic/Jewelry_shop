import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./users.controller";
import { adminUpdateUserSchema, createUserSchema, idParamSchema, listUsersQuerySchema } from "./users.schema";

/** Routes for user CRUD and order history; all require authentication. */
export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get(
  "/",
  authorize("ADMIN"),
  validate({ query: listUsersQuerySchema }),
  asyncHandler(controller.list)
);
usersRouter.post(
  "/",
  authorize("ADMIN"),
  validate({ body: createUserSchema }),
  asyncHandler(controller.create)
);
usersRouter.get("/:id", validate({ params: idParamSchema }), asyncHandler(controller.get));
usersRouter.get("/:id/orders", validate({ params: idParamSchema }), asyncHandler(controller.orderHistory));
usersRouter.get("/:id/order-summary", validate({ params: idParamSchema }), asyncHandler(controller.orderSummary));
usersRouter.post(
  "/:id/payment-reminder",
  authorize("ADMIN"),
  validate({ params: idParamSchema }),
  asyncHandler(controller.sendPaymentReminder)
);
usersRouter.patch(
  "/:id",
  validate({ params: idParamSchema, body: adminUpdateUserSchema }),
  asyncHandler(controller.update)
);
usersRouter.delete("/:id", authorize("ADMIN"), validate({ params: idParamSchema }), asyncHandler(controller.remove));
