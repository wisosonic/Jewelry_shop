import { api } from "../lib/api";
import type {
  AdminEventType,
  AdminNotificationPreference,
  CustomerEventType,
  Notification,
  NotificationPreference,
  Paginated,
} from "../types";

/** API wrappers for the in-app notification system. */

/** Fetches a page of the current user's own notifications, most recent first. */
export async function fetchMyNotifications(params?: { page?: number; pageSize?: number; unreadOnly?: boolean }) {
  const { data } = await api.get<Paginated<Notification>>("/notifications", { params });
  return data;
}

/** Fetches just the current user's unread notification count, for the navbar badge. */
export async function fetchUnreadNotificationCount() {
  const { data } = await api.get<{ count: number }>("/notifications/unread-count");
  return data.count;
}

/** Marks one notification as read. */
export async function markNotificationRead(id: string) {
  const { data } = await api.patch<{ notification: Notification }>(`/notifications/${id}/read`);
  return data.notification;
}

/** Marks every one of the current user's notifications as read. */
export async function markAllNotificationsRead() {
  await api.patch("/notifications/read-all");
}

/** Deletes one of the current user's own notifications. */
export async function deleteNotification(id: string) {
  await api.delete(`/notifications/${id}`);
}

/** Deletes every one of the current user's notifications ("clear all"). */
export async function deleteAllNotifications() {
  await api.delete("/notifications");
}

/** Fetches the calling admin's own notification preferences (admin only). */
export async function fetchAdminNotificationPreferences() {
  const { data } = await api.get<{ messagingEnabled: boolean; preferences: AdminNotificationPreference[] }>(
    "/notifications/admin-preferences"
  );
  return data;
}

/** Upserts the calling admin's preference for one event type (admin only). */
export async function updateAdminNotificationPreference(input: {
  eventType: AdminEventType;
  enabled: boolean;
  channel: "NONE" | "EMAIL" | "SMS";
}) {
  const { data } = await api.patch<{ messagingEnabled: boolean; preferences: AdminNotificationPreference[] }>(
    "/notifications/admin-preferences",
    input
  );
  return data;
}

/** Sets the calling admin's master email/SMS messaging switch (admin only). */
export async function updateNotificationMessagingEnabled(enabled: boolean) {
  const { data } = await api.patch<{ messagingEnabled: boolean; preferences: AdminNotificationPreference[] }>(
    "/notifications/messaging-enabled",
    { enabled }
  );
  return data;
}

/** Sends a notification to one customer, or broadcasts to every customer when `userId` is omitted (admin only). */
export async function sendBroadcastNotification(input: { message: string; userId?: string }) {
  const { data } = await api.post<{ notifiedCount: number }>("/notifications/broadcast", input);
  return data.notifiedCount;
}

/** Fetches the calling user's own preferences for the five customer-facing categories - any authenticated user, in-app only. */
export async function fetchMyNotificationPreferences() {
  const { data } = await api.get<{ preferences: NotificationPreference[] }>("/notifications/preferences");
  return data.preferences;
}

/** Upserts the calling user's preference for one customer-facing category. */
export async function updateMyNotificationPreference(input: { eventType: CustomerEventType; enabled: boolean }) {
  const { data } = await api.patch<{ preferences: NotificationPreference[] }>("/notifications/preferences", input);
  return data.preferences;
}
