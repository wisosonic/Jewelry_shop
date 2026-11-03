import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./dashboard.controller";

/** Routes for admin dashboard metrics; admin only. */
export const dashboardRouter = Router();
dashboardRouter.use(authenticate, authorize("ADMIN"));
dashboardRouter.get("/summary", asyncHandler(controller.summary));
