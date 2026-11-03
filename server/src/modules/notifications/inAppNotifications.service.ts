import { prisma } from "../../db/prisma";
import { emitToUser } from "../../realtime";
import { AppError } from "../../utils/AppError";
import { ADMIN_ROLES } from "../../utils/roles";
import { smsService } from "../sms/sms.service";
import { ADMIN_EVENT_TYPES, CATEGORY_BY_TYPE, CUSTOMER_EVENT_TYPES, NOTIFICATION_CHANNELS } from "./inAppNotifications.schema";
import { notificationService } from "./notification.service";

/**
 * Business logic for the in-app notification system: creating/reading a
 * user's own notifications, everyone's per-category preferences, an
 * admin's additional email/SMS delivery preference, and the admin
 * broadcast tool. Distinct from `notification.service.ts` (the *email*
 * delivery adapter, used only for password reset and an admin's opted-in
 * email alert) - everything here is the `Notification` Prisma model.
 */

type NotificationType = keyof typeof CATEGORY_BY_TYPE;
type AdminEventType = (typeof ADMIN_EVENT_TYPES)[number];
type CustomerEventType = (typeof CUSTOMER_EVENT_TYPES)[number];
type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Creates one notification row and, if the recipient has an open
 * connection, pushes it live over Socket.IO (`emitToUser` is a safe no-op
 * otherwise - e.g. the user isn't currently connected, or this is running
 * in a test that never started the real server). This is the one low-level
 * primitive every trigger site in the app goes through, directly or via
 * `notifyAdminsOfEvent`/`sendBroadcastNotification` below - and the single
 * place that enforces the recipient's own preference: every `type` maps to
 * a coarser preference category (`CATEGORY_BY_TYPE`), and a disabled
 * category means no row is created at all (not even for the admin path,
 * though `notifyAdminsOfEvent` also checks this itself first, before ever
 * calling this, so it can decide the external-channel leg in the same
 * pass).
 * @returns the created notification, or `null` if the recipient has this category disabled.
 */
export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  message: string;
  link?: string | null;
}) {
  const category = CATEGORY_BY_TYPE[params.type];
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_eventType: { userId: params.userId, eventType: category } },
  });
  if (pref && !pref.enabled) return null;

  const notification = await prisma.notification.create({
    data: { userId: params.userId, type: params.type, message: params.message, link: params.link ?? null },
  });
  emitToUser(params.userId, "notification", notification);
  return notification;
}

/** Lists a user's own notifications, most recent first, paginated, optionally unread-only. */
export async function listNotificationsForUser(
  userId: string,
  query: { page: number; pageSize: number; unreadOnly?: boolean }
) {
  const where = { userId, ...(query.unreadOnly ? { isRead: false } : {}) };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** Counts a user's unread notifications - cheap, for the navbar badge. */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

/**
 * Marks one notification read.
 * @throws {AppError} 404 if it doesn't exist, 403 if it belongs to someone else.
 */
export async function markNotificationRead(id: string, userId: string) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) throw AppError.notFound("Notification not found");
  if (notification.userId !== userId) throw AppError.forbidden();
  return prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
}

/** Marks every one of a user's unread notifications as read at once. */
export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
}

/**
 * Deletes one notification.
 * @throws {AppError} 404 if it doesn't exist, 403 if it belongs to someone else.
 */
export async function deleteNotification(id: string, userId: string): Promise<void> {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) throw AppError.notFound("Notification not found");
  if (notification.userId !== userId) throw AppError.forbidden();
  await prisma.notification.delete({ where: { id } });
}

/** Deletes every one of a user's notifications ("clear all") - not just the unread ones, unlike `markAllRead()`. */
export async function deleteAllNotifications(userId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { userId } });
}

/** A preference's value when no row exists yet - see `NotificationPreference`'s schema comment. */
const DEFAULT_PREFERENCE: { enabled: boolean; channel: NotificationChannel } = { enabled: true, channel: "NONE" };

/** Fetches one user's preferences for a given set of event types, defaulted for any that don't have a row yet. */
async function getPreferences(userId: string, eventTypes: readonly string[]) {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId, eventType: { in: eventTypes as string[] } },
  });
  const byEventType = new Map(rows.map((row) => [row.eventType, row]));

  return eventTypes.map((eventType) => {
    const row = byEventType.get(eventType);
    return {
      eventType,
      enabled: row?.enabled ?? DEFAULT_PREFERENCE.enabled,
      channel: (row?.channel as NotificationChannel | undefined) ?? DEFAULT_PREFERENCE.channel,
    };
  });
}

/** Upserts one of a user's preferences. */
async function upsertPreference(userId: string, input: { eventType: string; enabled: boolean; channel: NotificationChannel }) {
  await prisma.notificationPreference.upsert({
    where: { userId_eventType: { userId, eventType: input.eventType } },
    update: { enabled: input.enabled, channel: input.channel },
    create: { userId, eventType: input.eventType, enabled: input.enabled, channel: input.channel },
  });
}

/** Fetches one admin's full preference set: the master messaging switch plus every admin event type. */
export async function getAdminPreferences(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    messagingEnabled: user.notificationMessagingEnabled,
    preferences: await getPreferences(userId, ADMIN_EVENT_TYPES),
  };
}

/** Upserts one admin's preference (enabled + external channel) for a single event type. */
export async function updateAdminPreference(
  userId: string,
  input: { eventType: AdminEventType; enabled: boolean; channel: NotificationChannel }
) {
  await upsertPreference(userId, input);
  return getAdminPreferences(userId);
}

/** Sets an admin's master email/SMS kill switch (see `User.notificationMessagingEnabled`'s schema comment). */
export async function updateMessagingEnabled(userId: string, enabled: boolean) {
  await prisma.user.update({ where: { id: userId }, data: { notificationMessagingEnabled: enabled } });
  return getAdminPreferences(userId);
}

/**
 * Fetches any user's preferences for the five customer-facing categories -
 * in-app only, so there's no channel/messaging concept here (unlike the
 * admin preferences above). Not role-restricted at the API layer (an admin
 * could fetch/edit these too, for their own `ACCOUNT_ACTIVITY` category in
 * particular), even though the client's preferences panel only surfaces
 * this to CUSTOMER-role viewers.
 */
export async function getCustomerPreferences(userId: string) {
  const preferences = await getPreferences(userId, CUSTOMER_EVENT_TYPES);
  return { preferences: preferences.map(({ eventType, enabled }) => ({ eventType, enabled })) };
}

/** Upserts one of a user's customer-facing category preferences - channel is always forced to "NONE". */
export async function updatePreference(userId: string, input: { eventType: CustomerEventType; enabled: boolean }) {
  await upsertPreference(userId, { ...input, channel: "NONE" });
  return getCustomerPreferences(userId);
}

/**
 * Notifies every admin of one of the four admin-facing events
 * (`ADMIN_EVENT_TYPES`). For each admin: skips them entirely (not even
 * in-app) if their preference for this event has `enabled: false`;
 * otherwise always creates an in-app notification via `createNotification()`
 * (which re-checks the same preference - redundant here, but it's the
 * single source of truth every other call site also relies on), and
 * additionally sends an email/SMS alert only when their preference's
 * `channel` isn't "NONE" *and* their own `notificationMessagingEnabled`
 * master switch is on - both conditions exist independently on purpose
 * (see their schema comments), so either one being off suppresses the
 * external message without touching the in-app notification. Never throws
 * - a notification failure must never break the event that triggered it
 * (registration, a stock update, error handling itself); callers still get
 * a rejected promise logged to the console rather than silently swallowed
 * everywhere.
 */
export async function notifyAdminsOfEvent(
  eventType: AdminEventType,
  params: { message: string; link?: string | null }
): Promise<void> {
  try {
    // SUPER_ADMIN also receives these admin-facing alerts - it has every
    // ADMIN permission, including this one (see utils/roles.ts).
    const admins = await prisma.user.findMany({
      where: { role: { in: [...ADMIN_ROLES] } },
      include: { notificationPreferences: { where: { eventType } } },
    });

    for (const admin of admins) {
      const pref = admin.notificationPreferences[0];
      if (pref && !pref.enabled) continue;

      await createNotification({ userId: admin.id, type: eventType, message: params.message, link: params.link });

      const channel = (pref?.channel as NotificationChannel | undefined) ?? "NONE";
      if (!admin.notificationMessagingEnabled || channel === "NONE") continue;

      if (channel === "EMAIL" && admin.email) {
        await notificationService.sendAdminAlert({ toEmail: admin.email, message: params.message });
      } else if (channel === "SMS" && admin.phone) {
        await smsService.sendAdminAlert({ toPhone: admin.phone, message: params.message });
      }
    }
  } catch (err) {
    console.error(`[notifications] failed to notify admins of ${eventType}:`, err);
  }
}

/**
 * Sends a one-off in-app notification: to a single customer if `userId` is
 * given, or broadcast to every customer otherwise. Not batch-optimized (a
 * simple loop, one row per recipient) - a broadcast is a rare admin action
 * against this app's small user base, unlike the hot customer-facing paths
 * that justify a batched query elsewhere (e.g. `products.service.ts`'s
 * `attachRatings()`). Respects each recipient's own `PROMOTION` preference
 * via `createNotification()` - a customer who disabled promotions is
 * silently skipped, not counted.
 * @returns how many customers were actually notified (excludes anyone who has promotions disabled).
 */
export async function sendBroadcastNotification(params: { message: string; userId?: string }): Promise<number> {
  if (params.userId) {
    const notification = await createNotification({ userId: params.userId, type: "PROMOTION", message: params.message });
    return notification ? 1 : 0;
  }

  const customers = await prisma.user.findMany({ where: { role: "CUSTOMER" }, select: { id: true } });
  let notifiedCount = 0;
  for (const customer of customers) {
    const notification = await createNotification({ userId: customer.id, type: "PROMOTION", message: params.message });
    if (notification) notifiedCount += 1;
  }
  return notifiedCount;
}
