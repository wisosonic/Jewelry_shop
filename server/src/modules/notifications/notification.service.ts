/**
 * Notification provider adapter interface so a real provider (Twilio,
 * SendGrid, ...) can be dropped in later without touching any calling code
 * (orders, auth, etc). Only the two flows that genuinely can't be delivered
 * in-app go through here: a password-reset link (the user isn't logged in
 * to see an in-app notification) and an admin's own opted-in email alert
 * (see modules/notifications/inAppNotifications.service.ts's
 * `notifyAdminsOfEvent()`). Every other event in the app - order
 * confirmation/status, account-deletion warnings, wishlist restock,
 * promotions - is in-app only now (see the `Notification` model in
 * schema.prisma), not delivered through this adapter at all.
 */
export interface NotificationService {
  sendPasswordReset(params: { toEmail: string; resetUrl: string }): Promise<void>;
  sendAdminAlert(params: { toEmail: string; message: string }): Promise<void>;
}

/** Placeholder notification backend that logs to the console instead of sending real messages. */
class ConsoleNotificationService implements NotificationService {
  /**
   * Logs a password-reset link instead of emailing it. Unlike the
   * registration OTP (a short code delivered via SMS - see
   * `modules/sms/sms.service.ts`), a reset link's token is meant to be
   * delivered verbatim inside the message body - so, same as a real email
   * would, this includes the full URL (token and all). That's also the only
   * way to exercise the reset flow locally without a real email provider.
   */
  async sendPasswordReset({ toEmail, resetUrl }: { toEmail: string; resetUrl: string }) {
    console.log(`[notifications] would email ${toEmail}: reset your password at ${resetUrl}`);
  }

  /** Logs an admin's opted-in email alert instead of sending it - see notifyAdminsOfEvent(). */
  async sendAdminAlert({ toEmail, message }: { toEmail: string; message: string }) {
    console.log(`[notifications] would email admin ${toEmail}: ${message}`);
  }
}

/** Active notification service instance used across the app. */
export const notificationService: NotificationService = new ConsoleNotificationService();
