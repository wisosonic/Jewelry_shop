import twilio from "twilio";
import { env } from "../../config/env";

/**
 * SMS provider adapter interface, mirroring the `PaymentProvider`/
 * `NotificationService` pattern - a real backend (Twilio today) sits behind
 * this so call sites never talk to Twilio directly. Only two flows use SMS
 * now: the registration OTP (the only way to verify a phone number at all)
 * and an admin's own opted-in SMS alert (see
 * modules/notifications/inAppNotifications.service.ts's
 * `notifyAdminsOfEvent()`) - the unverified-account deletion warning is
 * in-app only now (see the `Notification` model in schema.prisma), not sent
 * via SMS.
 */
export interface SmsService {
  sendOtp(params: { toPhone: string; code: string }): Promise<void>;
  sendAdminAlert(params: { toPhone: string; message: string }): Promise<void>;
}

/**
 * Sends the registration OTP and an admin's opted-in SMS alert via Twilio.
 * When `TWILIO_*` env vars are unset (or Twilio rejects them - e.g. the
 * dummy placeholder values this app ships with by default), falls back to
 * logging the message to the console instead of failing the calling flow
 * outright - the same "not configured" convention `metals.service.ts` uses
 * for `METALS_API_KEY`, and the only way to exercise either flow locally
 * without a real Twilio account.
 */
class TwilioSmsService implements SmsService {
  async sendOtp({ toPhone, code }: { toPhone: string; code: string }): Promise<void> {
    await this.sendText(toPhone, `Your Naya Sophia verification code is ${code}.`, `OTP for ${toPhone}: ${code}`);
  }

  /** Sends an admin's opted-in SMS alert - see notifyAdminsOfEvent(). */
  async sendAdminAlert({ toPhone, message }: { toPhone: string; message: string }): Promise<void> {
    await this.sendText(toPhone, `Naya Sophia admin alert: ${message}`, `Admin alert for ${toPhone}: ${message}`);
  }

  /**
   * Shared send path for both methods above: calls Twilio when configured,
   * otherwise (or on any Twilio error) logs `fallbackLine` to the console
   * instead - the "not configured" convention `metals.service.ts` uses for
   * `METALS_API_KEY`, and the only way to read these messages locally
   * without a real Twilio account.
   *
   * `fallbackLine` (which can contain a real OTP code) is only ever printed
   * outside production - in production, a fallback logs just the fact that
   * delivery failed, never the message content. Without this, a *transient*
   * Twilio failure in production (rate limit, bad number, expired
   * credentials, a network blip - not just "unconfigured") would otherwise
   * print a real user's verification code to server logs.
   */
  private async sendText(toPhone: string, body: string, fallbackLine: string): Promise<void> {
    const { twilioAccountSid, twilioAuthToken, twilioFromNumber } = env;

    const logFallback = (reason: string) => {
      if (env.nodeEnv === "production") {
        console.log(`[sms] ${reason} - message to ${toPhone} was not delivered.`);
      } else {
        console.log(`[sms] ${reason} - ${fallbackLine}`);
      }
    };

    if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
      logFallback("Twilio not configured");
      return;
    }

    try {
      const client = twilio(twilioAccountSid, twilioAuthToken);
      await client.messages.create({ to: toPhone, from: twilioFromNumber, body });
    } catch (err) {
      console.error("[sms] Failed to send via Twilio:", err);
      logFallback("Twilio send failed");
    }
  }
}

/** Active SMS provider instance used by the auth module. */
export const smsService: SmsService = new TwilioSmsService();
