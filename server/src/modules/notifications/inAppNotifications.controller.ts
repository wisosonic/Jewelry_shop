import { Request, Response } from "express";
import * as notificationsService from "./inAppNotifications.service";

/** HTTP handlers for the in-app notification system. */

/** Lists the caller's own notifications, paginated. */
export async function list(req: Request, res: Response) {
  const query = req.query as unknown as { page: number; pageSize: number; unreadOnly?: string };
  res.json(
    await notificationsService.listNotificationsForUser(req.user!.id, {
      page: query.page,
      pageSize: query.pageSize,
      unreadOnly: query.unreadOnly === "true",
    })
  );
}

/** Returns the caller's unread notification count, for the navbar badge. */
export async function unreadCount(req: Request, res: Response) {
  res.json({ count: await notificationsService.getUnreadCount(req.user!.id) });
}

/** Marks one of the caller's own notifications as read. */
export async function markRead(req: Request, res: Response) {
  const notification = await notificationsService.markNotificationRead(req.params.id, req.user!.id);
  res.json({ notification });
}

/** Marks every one of the caller's notifications as read. */
export async function markAllRead(req: Request, res: Response) {
  await notificationsService.markAllRead(req.user!.id);
  res.status(204).send();
}

/** Deletes one of the caller's own notifications. */
export async function remove(req: Request, res: Response) {
  await notificationsService.deleteNotification(req.params.id, req.user!.id);
  res.status(204).send();
}

/** Deletes every one of the caller's notifications ("clear all"). */
export async function removeAll(req: Request, res: Response) {
  await notificationsService.deleteAllNotifications(req.user!.id);
  res.status(204).send();
}

/** Fetches the calling admin's own notification preferences. */
export async function getAdminPreferences(req: Request, res: Response) {
  res.json(await notificationsService.getAdminPreferences(req.user!.id));
}

/** Upserts the calling admin's preference for one event type. */
export async function updateAdminPreference(req: Request, res: Response) {
  res.json(await notificationsService.updateAdminPreference(req.user!.id, req.body));
}

/** Fetches the caller's own preferences for the five customer-facing categories. */
export async function getPreferences(req: Request, res: Response) {
  res.json(await notificationsService.getCustomerPreferences(req.user!.id));
}

/** Upserts the caller's own preference for one customer-facing category. */
export async function updatePreference(req: Request, res: Response) {
  res.json(await notificationsService.updatePreference(req.user!.id, req.body));
}

/** Sets the calling admin's master email/SMS messaging switch. */
export async function updateMessagingEnabled(req: Request, res: Response) {
  res.json(await notificationsService.updateMessagingEnabled(req.user!.id, req.body.enabled));
}

/** Sends a broadcast (or single-recipient) promotional notification (admin only). */
export async function broadcast(req: Request, res: Response) {
  const notifiedCount = await notificationsService.sendBroadcastNotification(req.body);
  res.status(201).json({ notifiedCount });
}
