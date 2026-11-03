import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./settings.controller";
import { updateSettingsSchema } from "./settings.schema";

/** Routes for reading and updating global app settings; admin only. */
export const settingsRouter = Router();
settingsRouter.use(authenticate, authorize("ADMIN"));

settingsRouter.get("/", asyncHandler(controller.get));
settingsRouter.patch("/", validate({ body: updateSettingsSchema }), asyncHandler(controller.update));
