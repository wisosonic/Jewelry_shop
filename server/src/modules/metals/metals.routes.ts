import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./metals.controller";

/** Routes for reading current metal prices (public) and forcing a refresh (admin only). */
export const metalsRouter = Router();

metalsRouter.get("/latest", asyncHandler(controller.latest));
metalsRouter.post("/refresh", authenticate, authorize("ADMIN"), asyncHandler(controller.refresh));
