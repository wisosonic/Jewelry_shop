import { z } from "zod";

/** Validation schemas and enums for the in-app notification endpoints. */

// Every notification type this app creates. The last four are admin-only
// (see ADMIN_EVENT_TYPES below); the rest only ever go to CUSTOMER-role users.
export const NOTIFICATION_TYPES = [
  "ORDER_CONFIRMED",
  "ORDER_STATUS_UPDATED",
  "PASSWORD_CHANGED",
  "NEW_LOGIN",
  "PROFILE_UPDATED",
  "ACCOUNT_DELETION_WARNING",
  "WISHLIST_BACK_IN_STOCK",
  "PROMOTION",
  "PAYMENT_REMINDER",
  "USER_SIGNUP",
  "LOW_STOCK",
  "CRITICAL_ERROR",
  "NEW_ORDER",
] as const;

/** The event categories an admin can individually configure (see NotificationPreference). */
export const ADMIN_EVENT_TYPES = ["USER_SIGNUP", "LOW_STOCK", "CRITICAL_ERROR", "NEW_ORDER"] as const;

/**
 * The event categories a regular (CUSTOMER-role) user can individually
 * configure - coarser than `NOTIFICATION_TYPES`: `ORDER_UPDATES` and
 * `ACCOUNT_ACTIVITY` each group several notification types (see
 * `CATEGORY_BY_TYPE` below); the other three map 1:1 with a type of the
 * same name.
 */
export const CUSTOMER_EVENT_TYPES = [
  "ORDER_UPDATES",
  "ACCOUNT_ACTIVITY",
  "PROMOTION",
  "ACCOUNT_DELETION_WARNING",
  "WISHLIST_BACK_IN_STOCK",
] as const;

/**
 * Maps every notification `type` to the (coarser) preference category its
 * enable/disable toggle actually controls - `createNotification()`'s single
 * enforcement point for "did this recipient turn this category off". Every
 * `NOTIFICATION_TYPES` entry has an explicit mapping here, including the
 * identity ones, so a new type can't accidentally ship without one.
 */
export const CATEGORY_BY_TYPE: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  ORDER_CONFIRMED: "ORDER_UPDATES",
  ORDER_STATUS_UPDATED: "ORDER_UPDATES",
  PASSWORD_CHANGED: "ACCOUNT_ACTIVITY",
  NEW_LOGIN: "ACCOUNT_ACTIVITY",
  PROFILE_UPDATED: "ACCOUNT_ACTIVITY",
  ACCOUNT_DELETION_WARNING: "ACCOUNT_DELETION_WARNING",
  WISHLIST_BACK_IN_STOCK: "WISHLIST_BACK_IN_STOCK",
  PROMOTION: "PROMOTION",
  // Under ORDER_UPDATES, not its own category - it's about an existing
  // order's payment, the same category ORDER_CONFIRMED/ORDER_STATUS_UPDATED
  // already live under (see the admin-triggered "Send payment reminder"
  // bullet under domain invariant #9 in CLAUDE.md).
  PAYMENT_REMINDER: "ORDER_UPDATES",
  USER_SIGNUP: "USER_SIGNUP",
  LOW_STOCK: "LOW_STOCK",
  CRITICAL_ERROR: "CRITICAL_ERROR",
  NEW_ORDER: "NEW_ORDER",
};

/** An admin's external-delivery choice for one event type - "NONE" means in-app only. */
export const NOTIFICATION_CHANNELS = ["NONE", "EMAIL", "SMS"] as const;

export const idParamSchema = z.object({ id: z.string().min(1) });

/** Query params for `GET /notifications` - paginated, optionally unread-only. */
export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.enum(["true"]).optional(),
});

/** Request body for `PATCH /notifications/admin-preferences` - upserts one event type's preference (admin only). */
export const updateAdminPreferenceSchema = z.object({
  eventType: z.enum(ADMIN_EVENT_TYPES),
  enabled: z.boolean(),
  channel: z.enum(NOTIFICATION_CHANNELS),
});

/** Request body for `PATCH /notifications/preferences` - upserts one category's preference (any authenticated user, in-app only - no channel). */
export const updatePreferenceSchema = z.object({
  eventType: z.enum(CUSTOMER_EVENT_TYPES),
  enabled: z.boolean(),
});

/** Request body for `PATCH /notifications/messaging-enabled`. */
export const updateMessagingEnabledSchema = z.object({
  enabled: z.boolean(),
});

/** Request body for `POST /notifications/broadcast` - omitting `userId` broadcasts to every customer. */
export const broadcastNotificationSchema = z.object({
  message: z.string().min(1).max(500),
  userId: z.string().min(1).optional(),
});
