import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./inAppNotifications.controller";
import {
  broadcastNotificationSchema,
  idParamSchema,
  listNotificationsQuerySchema,
  updateAdminPreferenceSchema,
  updateMessagingEnabledSchema,
  updatePreferenceSchema,
} from "./inAppNotifications.schema";

/**
 * Routes for the in-app notification system; all require authentication.
 * The admin-preferences/messaging/broadcast routes are additionally
 * `authorize("ADMIN")`-gated. Static routes (`/unread-count`, `/read-all`,
 * etc.) are registered above the dynamic `/:id/read` route, matching this
 * app's usual bulk-route-before-`/:id` convention, even though none of them
 * actually share a path shape with it here.
 */
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get("/", validate({ query: listNotificationsQuerySchema }), asyncHandler(controller.list));
notificationsRouter.get("/unread-count", asyncHandler(controller.unreadCount));
notificationsRouter.patch("/read-all", asyncHandler(controller.markAllRead));
// "Clear all" - registered above the dynamic `/:id` delete route below, per
// this app's usual bulk-route-before-`/:id` convention (no actual path
// collision here since one has an id segment and the other doesn't, but
// keeping the ordering consistent with every other module is worth more
// than the one line it costs).
notificationsRouter.delete("/", asyncHandler(controller.removeAll));

// Any authenticated user's own in-app-only category preferences (no role
// restriction - every user manages their own row the same way GET/PATCH
// /notifications already does). Distinct from the admin-only
// /admin-preferences below, which additionally covers the external channel.
notificationsRouter.get("/preferences", asyncHandler(controller.getPreferences));
notificationsRouter.patch(
  "/preferences",
  validate({ body: updatePreferenceSchema }),
  asyncHandler(controller.updatePreference)
);

notificationsRouter.get(
  "/admin-preferences",
  authorize("ADMIN"),
  asyncHandler(controller.getAdminPreferences)
);
notificationsRouter.patch(
  "/admin-preferences",
  authorize("ADMIN"),
  validate({ body: updateAdminPreferenceSchema }),
  asyncHandler(controller.updateAdminPreference)
);
notificationsRouter.patch(
  "/messaging-enabled",
  authorize("ADMIN"),
  validate({ body: updateMessagingEnabledSchema }),
  asyncHandler(controller.updateMessagingEnabled)
);
notificationsRouter.post(
  "/broadcast",
  authorize("ADMIN"),
  validate({ body: broadcastNotificationSchema }),
  asyncHandler(controller.broadcast)
);

notificationsRouter.patch(
  "/:id/read",
  validate({ params: idParamSchema }),
  asyncHandler(controller.markRead)
);
notificationsRouter.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove)
);
