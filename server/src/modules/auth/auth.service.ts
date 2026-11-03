import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { smsService } from "../sms/sms.service";
import { AppError } from "../../utils/AppError";
import { hashPassword, verifyPassword } from "../../utils/password";
import { generateOtpCode } from "../../utils/otp";
import {
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../../utils/jwt";
import { notificationService } from "../notifications/notification.service";
import { createNotification, notifyAdminsOfEvent } from "../notifications/inAppNotifications.service";
import { getSettings } from "../settings/settings.service";
import { z } from "zod";
import { registerSchema } from "./auth.schema";

/** How long a password-reset link stays valid before the user must request a new one. */
const RESET_TOKEN_TTL_MINUTES = 30;

/** How many consecutive wrong guesses a single OTP code tolerates before it's invalidated, independent of the auth rate limiter on the route itself. */
const MAX_OTP_ATTEMPTS = 5;

/**
 * How many wrong guesses, globally across every account, the
 * `universalOtpCode` bypass tolerates before it's temporarily disabled -
 * see `Settings.universalOtpFailedAttempts`'s schema comment for why this
 * needs to be global rather than per-account.
 */
const MAX_UNIVERSAL_OTP_FAILED_ATTEMPTS = 10;

/** How long the universal OTP bypass stays disabled once `MAX_UNIVERSAL_OTP_FAILED_ATTEMPTS` is hit. */
const UNIVERSAL_OTP_LOCKOUT_MINUTES = 15;

/**
 * Business logic for authentication: registration, login, refresh-token
 * lifecycle (issue, rotate, revoke), and registration OTP verification,
 * backed by the database.
 */

/** Strips sensitive fields (e.g. password hash) from a user record before returning it to clients. */
function toPublicUser(user: {
  id: string;
  email: string | null;
  name: string;
  role: string;
  phone: string | null;
  address: string | null;
  isVerified: boolean;
  lastLoginAt: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    address: user.address,
    isVerified: user.isVerified,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Generates a fresh OTP code for the user, persists its hash (never the
 * plain code), and sends it via SMS. Used by both registration and
 * `resendOtp()`.
 */
async function issueAndSendOtp(user: { id: string; phone: string | null }): Promise<void> {
  if (!user.phone) throw AppError.badRequest("No phone number on file to send a verification code to.");

  const code = generateOtpCode();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      codeHash: hashToken(code),
    },
  });
  await smsService.sendOtp({ toPhone: user.phone, code });
}

/**
 * Creates a new customer account and starts a session for them. Normally
 * this leaves the account unverified and sends a registration OTP to their
 * phone (limited-access - see `orders.service.ts`'s `createOrder()` - until
 * they verify) - but if an admin has turned off `Settings.otpVerificationEnabled`
 * (see its schema comment), OTP verification is skipped entirely and the
 * account is created already verified, with no code issued at all.
 * @throws {AppError} 409 if the phone (or, if given, the email) is already registered.
 */
export async function registerUser(input: z.infer<typeof registerSchema>) {
  const existingByPhone = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (existingByPhone) throw AppError.conflict("An account with this phone number already exists");

  if (input.email) {
    const existingByEmail = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingByEmail) throw AppError.conflict("An account with this email already exists");
  }

  const settings = await getSettings();
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      phone: input.phone,
      address: input.address,
      role: "CUSTOMER",
      isVerified: !settings.otpVerificationEnabled,
    },
  });

  if (settings.otpVerificationEnabled) {
    await issueAndSendOtp(user);
  }

  // Awaited so the notification row exists by the time this call returns
  // (not a detached fire-and-forget, which would race the response) - but
  // `.catch()` still means a failure here can never fail the registration
  // itself (notifyAdminsOfEvent already swallows its own errors too; this
  // is a second layer of the same guarantee for anything unexpected).
  await notifyAdminsOfEvent("USER_SIGNUP", {
    message: `New customer registered: ${user.name}`,
    link: "/admin/users",
  }).catch(() => {});

  return issueSession(user);
}

/**
 * Verifies credentials and starts a session. `identifier` may be either an
 * email address or a phone number, since registration allows an emailless
 * account. Login is allowed regardless of OTP-verification status (see the
 * `isVerified` domain invariant) - only placing an order is gated on it.
 * Records `lastLoginAt` - deliberately only here, not on registration
 * (creating an account isn't "logging in" again) and not on a silent
 * refresh-token rotation (that's the same session continuing, not a new
 * login event).
 * @throws {AppError} 401 if the identifier or password is incorrect.
 */
export async function loginUser(identifier: string, password: string) {
  const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { phone: identifier }] } });
  if (!user) throw AppError.unauthorized("Invalid email or password");

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw AppError.unauthorized("Invalid email or password");

  const loggedInUser = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  // Awaited (not detached) so the row exists before this returns; `.catch()`
  // still means a failure here can never fail the login itself.
  await createNotification({
    userId: user.id,
    type: "NEW_LOGIN",
    message: "New login to your account.",
    link: "/profile",
  }).catch(() => {});

  return issueSession(loggedInUser);
}

/**
 * Verifies a registration OTP code and, on success, marks the account
 * verified. Single-use per code (consumed on success) and caps wrong
 * guesses at `MAX_OTP_ATTEMPTS` - past that, the caller must request a new
 * one via `resendOtp()`. Deliberately does NOT check an expiry - OTP codes
 * never expire in this app (a product decision - see `OtpCode`'s doc
 * comment in schema.prisma), so a shopper can activate their account
 * whenever they get around to entering the code. This function never
 * issues a replacement code itself on any failure path - resending only
 * ever happens in response to the caller explicitly hitting `resendOtp()`.
 *
 * Before any of that: if an admin has set `Settings.universalOtpCode` and
 * the submitted code matches it exactly, the account is verified
 * immediately regardless of whose account it is, what their own code was,
 * or how many attempts they'd already used - see that field's schema
 * comment for why this bypass exists and the tradeoff it represents. This
 * check is intentionally cheap (one Settings row, already cached by
 * Prisma's connection-level query plan) and runs first so it's never
 * affected by the per-user code's own state. It's also globally
 * brute-force-protected (`universalOtpFailedAttempts`/`universalOtpLockedUntil`)
 * separately from the per-account `OtpCode.attempts` cap below - a
 * per-account cap alone would be meaningless here, since an attacker can
 * just register a fresh account to reset it, but they can't reset a
 * global counter.
 * @throws {AppError} 400 if there's no pending code or attempts are
 * exhausted - each with `details.requiresResend: true` so the client can
 * point the user at resending rather than retrying - or if the code just
 * doesn't match (no `requiresResend`, since retrying can still work).
 */
export async function verifyOtp(userId: string, code: string): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const universalOtpLocked = !!settings?.universalOtpLockedUntil && settings.universalOtpLockedUntil > new Date();

  if (settings?.universalOtpCode && !universalOtpLocked) {
    if (code === settings.universalOtpCode) {
      await prisma.$transaction([
        prisma.otpCode.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } }),
        prisma.user.update({ where: { id: userId }, data: { isVerified: true } }),
        // A confirmed-correct guess means the code is now known regardless
        // of the failure history, so the counter no longer serves a
        // purpose - reset it rather than let it keep accumulating toward a
        // lockout that wouldn't stop anything at this point anyway.
        prisma.settings.update({ where: { id: 1 }, data: { universalOtpFailedAttempts: 0, universalOtpLockedUntil: null } }),
      ]);
      return;
    }

    // Every wrong code counts against the global bypass-specific counter,
    // not just deliberate guesses at it - there's no way to distinguish
    // "trying to guess the universal code" from "mistyped my own real
    // code", and it doesn't matter: either way, this is one more wrong
    // code the shared secret was exposed to.
    const failedAttempts = settings.universalOtpFailedAttempts + 1;
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        universalOtpFailedAttempts: failedAttempts,
        ...(failedAttempts >= MAX_UNIVERSAL_OTP_FAILED_ATTEMPTS
          ? { universalOtpLockedUntil: new Date(Date.now() + UNIVERSAL_OTP_LOCKOUT_MINUTES * 60_000) }
          : {}),
      },
    });
  }

  const otp = await prisma.otpCode.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  // Both cases share one trait the client keys off of
  // (`details.requiresResend`) - no amount of retrying the code entry can
  // succeed, so the UI should push the shopper toward "resend" rather than
  // "try again": there's nothing pending, or it's been guessed against too
  // many times to trust anymore.
  if (!otp) throw AppError.badRequest("No pending verification code. Request a new one.", { requiresResend: true });
  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    throw AppError.badRequest("Too many incorrect attempts. Request a new one.", { requiresResend: true });
  }

  if (hashToken(code) !== otp.codeHash) {
    // Atomic conditional increment (not a plain update()) - closes a race
    // where several concurrent wrong guesses all read the same pre-increment
    // `attempts` value above and would otherwise all pass the `>=
    // MAX_OTP_ATTEMPTS` check before any of their increments commit. The
    // `attempts: { lt: MAX_OTP_ATTEMPTS }` condition is re-checked by the
    // database at write time, so only genuinely-still-under-the-cap
    // increments succeed; a concurrent request that loses the race affects
    // zero rows and falls into the same "too many attempts" branch below.
    const result = await prisma.otpCode.updateMany({
      where: { id: otp.id, attempts: { lt: MAX_OTP_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (result.count === 0) {
      throw AppError.badRequest("Too many incorrect attempts. Request a new one.", { requiresResend: true });
    }
    throw AppError.badRequest("Incorrect code.");
  }

  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({ where: { id: userId }, data: { isVerified: true } }),
  ]);
}

/**
 * Issues and sends a fresh OTP code, invalidating any still-pending one so
 * only the newest code is ever valid at a time. Enforces a per-account
 * cooldown (`env.otpResendCooldownSeconds`, measured from the *previous*
 * code's `createdAt` regardless of its consumed/pending status) on top of
 * the IP-based `otpResendRateLimiter` already on the route - the cooldown
 * catches repeated resends against one account from anywhere, the rate
 * limiter catches high resend volume from one IP across accounts. Since
 * OTP codes never expire (see `OtpCode`'s doc comment), this cooldown is
 * also the only thing standing between "resend" and effectively unlimited
 * SMS spend for a given account.
 * @throws {AppError} 400 if the account is already verified or has no
 * phone on file; 429 (with `details.retryAfterSeconds`) if still within
 * the cooldown window since the last code was issued.
 */
export async function resendOtp(userId: string): Promise<{ cooldownSeconds: number }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.isVerified) throw AppError.badRequest("This account is already verified.");

  const lastOtp = await prisma.otpCode.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  if (lastOtp) {
    const cooldownMs = env.otpResendCooldownSeconds * 1000;
    const elapsedMs = Date.now() - lastOtp.createdAt.getTime();
    if (elapsedMs < cooldownMs) {
      const retryAfterSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
      throw AppError.tooManyRequests(
        `Please wait ${retryAfterSeconds}s before requesting another code.`,
        { retryAfterSeconds }
      );
    }
  }

  await prisma.otpCode.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
  await issueAndSendOtp(user);
  return { cooldownSeconds: env.otpResendCooldownSeconds };
}

/** Signs a new access token and persists a new refresh token for the given user. */
async function issueSession(user: {
  id: string;
  email: string | null;
  role: string;
  name: string;
  phone: string | null;
  address: string | null;
  isVerified: boolean;
  lastLoginAt: Date | null;
}) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: refreshTokenExpiry(),
    },
  });

  return { accessToken, refreshToken, user: toPublicUser(user) };
}

/**
 * Validates a presented refresh token, revokes it, and issues a fresh
 * access/refresh token pair (rotation-on-use).
 *
 * If the presented token was *already* revoked at the moment this call
 * read it (as opposed to simply unknown), that means an earlier, separate,
 * already-completed rotation already moved past it, and this is a later,
 * distinct presentation of the same now-stale token - the classic signal
 * of a stolen refresh token being replayed by an attacker after the
 * legitimate device already rotated past it (or a client bug doing the
 * same). Rather than just rejecting that one request, every other active
 * session for the account is revoked too, the same precautionary response
 * `resetPassword()` already gives to a confirmed password compromise -
 * this call still only ever returns the same generic 401 either way, so
 * there's no information leak about *why* it failed.
 *
 * This is deliberately different from two requests racing for the *same*
 * not-yet-revoked token at the same instant - a real scenario, not just a
 * theoretical one: React StrictMode double-invokes effects in dev, so the
 * client's own mount-time silent-refresh can fire twice back to back for
 * the same cookie, and two browser tabs refreshing around the same moment
 * hit this the same way. A plain read-then-write here would let both
 * requests pass the checks below and both attempt to rotate, and whichever
 * commits second would then see the first's revocation and misidentify a
 * benign race as reuse - triggering the mass-revocation above for what
 * isn't an attack at all. The conditional `updateMany` below re-checks
 * `revokedAt: null` atomically at write time instead, so only one
 * concurrent caller can ever win it; the loser fails this call cleanly (a
 * plain 401 its own caller can retry or re-authenticate from) without
 * touching any other session. Only a token that was *already* revoked
 * before this call even started reading it takes the mass-revocation path
 * above - a client-side single-flight dedup (`lib/api.ts`'s
 * `refreshAccessToken()`) additionally prevents the same tab from ever
 * generating this race in the first place, but this still needs to hold on
 * its own for the cross-tab case that client-side dedup can't reach.
 * @throws {AppError} 401 if the token is unknown, revoked, or expired.
 */
export async function rotateRefreshToken(presentedToken: string) {
  const tokenHash = hashToken(presentedToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) {
    throw AppError.unauthorized("Invalid refresh token");
  }

  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw AppError.unauthorized("Invalid refresh token");
  }

  if (stored.expiresAt < new Date()) {
    throw AppError.unauthorized("Invalid refresh token");
  }

  const claimed = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw AppError.unauthorized("Invalid refresh token");
  }

  return issueSession(stored.user);
}

/** Marks the presented refresh token as revoked (logout), if it's still active. */
export async function revokeRefreshToken(presentedToken: string) {
  const tokenHash = hashToken(presentedToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Fetches a user's public profile by id.
 * @throws {AppError} 404 if no such user exists.
 */
export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.notFound("User not found");
  return toPublicUser(user);
}

/**
 * Starts a password reset: if the email matches an account, emails a reset
 * link carrying a random opaque token (hashed at rest, single-use,
 * time-limited - the same security shape as `RefreshToken`, and reusing
 * `generateRefreshToken()`/`hashToken()` since the requirements are
 * identical). Always resolves the same way regardless of whether the email
 * is registered, so this endpoint can't be used to enumerate accounts.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return; // Deliberately silent - don't reveal whether this email is registered.

  const token = generateRefreshToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    },
  });

  // The first configured origin is treated as the canonical one for
  // building an absolute link - there's no reliable, trustworthy signal at
  // request time for which of several allowed origins the user is actually
  // on (the request carries no Origin header for a same-origin form post,
  // and trusting a client-supplied origin for a redirect target would be an
  // open-redirect risk), so this always points at the "main" deployment.
  const resetUrl = `${env.clientOrigins[0]}/reset-password?token=${token}`;
  // Safe non-null assertion: this user was just looked up by that exact
  // (non-null) email value, via requestPasswordReset's own `email` param.
  await notificationService.sendPasswordReset({ toEmail: user.email!, resetUrl });
}

/**
 * Completes a password reset: verifies the token, sets the new password,
 * consumes the token (single-use), and revokes every refresh token on the
 * account so any other signed-in session is logged out - a password reset
 * is exactly the moment an account may have been compromised, so existing
 * sessions shouldn't survive it.
 * @throws {AppError} 400 if the token is missing, unknown, expired, or already used.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    throw AppError.badRequest("This reset link is invalid or has expired. Request a new one.");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  // A reset is a password change too - arguably the most important one to
  // be told about, since it's exactly the scenario where an account may
  // have been compromised. Awaited (not detached) so the row exists before
  // this returns; `.catch()` still means a failure here can never fail the
  // reset itself.
  await createNotification({
    userId: record.userId,
    type: "PASSWORD_CHANGED",
    message: "Your password was reset.",
  }).catch(() => {});
}
