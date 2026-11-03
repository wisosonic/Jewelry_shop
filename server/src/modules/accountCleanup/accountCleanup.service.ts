import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createNotification } from "../notifications/inAppNotifications.service";

/**
 * Business logic for the unverified-account lifecycle: warning a shopper
 * who registered but never completed OTP verification, then deleting the
 * account if they still haven't after `env.unverifiedAccountTtlDays`. Both
 * are driven by `accountCleanup.scheduler.ts`'s daily cron, not by any
 * HTTP route - there's no user-facing or admin-facing action that triggers
 * either directly.
 *
 * Only ever touches accounts where `isVerified` is `false`. Once an
 * account verifies, it's permanently out of scope for both functions
 * below, regardless of how old it is or whether a warning was already
 * sent (that history becomes moot at that point, not that
 * `deletionWarningSentAt` is ever explicitly cleared on verification -
 * there is nothing left that would ever consult it again for that user).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cutoff below which an unverified account is deletion-warning-eligible (old enough to warn, not yet old enough to delete). */
function warningWindowStart(): Date {
  const daysUntilWarn = env.unverifiedAccountTtlDays - env.unverifiedAccountWarningDaysBeforeDeletion;
  return new Date(Date.now() - daysUntilWarn * DAY_MS);
}

/** Cutoff at/beyond which an unverified account is deleted outright. */
function deletionCutoff(): Date {
  return new Date(Date.now() - env.unverifiedAccountTtlDays * DAY_MS);
}

/**
 * Sends a one-time in-app deletion warning to every unverified account
 * that's old enough to warn but not yet old enough to delete and hasn't
 * already been warned. Marks each as warned so a later run of this same job
 * (it runs daily) never re-sends it.
 *
 * In-app only, per this app's "regular users get no external channel"
 * notification-system rule (see CLAUDE.md) - a known, deliberately accepted
 * tradeoff of that rule: an account that never opens the app again will
 * never actually see this warning before it's deleted. That's a real
 * regression in this warning's practical reach compared to its original
 * SMS+email design, but it's what the rule means taken literally, and it
 * was chosen knowingly rather than carved out as a silent exception.
 * @returns how many accounts were warned, for the scheduler to log.
 */
export async function sendDeletionWarnings(): Promise<number> {
  const candidates = await prisma.user.findMany({
    where: {
      isVerified: false,
      deletionWarningSentAt: null,
      createdAt: { lte: warningWindowStart(), gt: deletionCutoff() },
    },
  });

  for (const user of candidates) {
    await createNotification({
      userId: user.id,
      type: "ACCOUNT_DELETION_WARNING",
      message: `Your account will be deleted in ${env.unverifiedAccountWarningDaysBeforeDeletion} day(s) unless you verify your phone number.`,
      link: "/verify-otp",
    });
    await prisma.user.update({ where: { id: user.id }, data: { deletionWarningSentAt: new Date() } });
  }

  return candidates.length;
}

/**
 * Permanently deletes every unverified account past
 * `env.unverifiedAccountTtlDays` old. Safe with respect to the
 * price-at-purchase snapshotting invariant and the `Order.user` foreign
 * key (which has no `onDelete: Cascade`, so deleting a user with orders
 * would otherwise fail): an unverified account can never have placed an
 * order (`orders.service.ts`'s `createOrder()` requires `isVerified`), so
 * this can never hit that constraint. `WishlistItem`/`Review`/`OtpCode`/
 * `RefreshToken`/`PasswordResetToken` all cascade-delete with the user.
 * @returns how many accounts were deleted, for the scheduler to log.
 */
export async function deleteExpiredUnverifiedAccounts(): Promise<number> {
  const result = await prisma.user.deleteMany({
    where: { isVerified: false, createdAt: { lte: deletionCutoff() } },
  });
  return result.count;
}
