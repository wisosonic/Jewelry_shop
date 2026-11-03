import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./revenue.controller";
import { revenueSummaryQuerySchema } from "./revenue.schema";

/** Routes for the admin revenue report; admin only. */
export const revenueRouter = Router();
revenueRouter.use(authenticate, authorize("ADMIN"));
revenueRouter.get("/summary", validate({ query: revenueSummaryQuerySchema }), asyncHandler(controller.summary));
