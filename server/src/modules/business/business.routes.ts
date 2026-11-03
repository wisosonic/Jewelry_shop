import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./business.controller";
import {
  createBusinessHolidaySchema,
  idParamSchema,
  updateBusinessHoursSchema,
  updateBusinessInfoSchema,
} from "./business.schema";

/**
 * Routes for the storefront's contact info, weekly hours, holiday
 * exceptions, and emergency override banner. `GET /` is public (the footer
 * and site-wide banner render for signed-out visitors too, same as
 * `/metals/latest`); every write is admin only.
 */
export const businessRouter = Router();

businessRouter.get("/", asyncHandler(controller.get));

businessRouter.patch(
  "/",
  authenticate,
  authorize("ADMIN"),
  validate({ body: updateBusinessInfoSchema }),
  asyncHandler(controller.update)
);

businessRouter.put(
  "/hours",
  authenticate,
  authorize("ADMIN"),
  validate({ body: updateBusinessHoursSchema }),
  asyncHandler(controller.setHours)
);

businessRouter.post(
  "/holidays",
  authenticate,
  authorize("ADMIN"),
  validate({ body: createBusinessHolidaySchema }),
  asyncHandler(controller.addHoliday)
);

businessRouter.delete(
  "/holidays/:id",
  authenticate,
  authorize("ADMIN"),
  validate({ params: idParamSchema }),
  asyncHandler(controller.removeHoliday)
);
