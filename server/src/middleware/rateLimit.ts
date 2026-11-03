import rateLimit from "express-rate-limit";
import { env } from "../config/env";

/**
 * Rate limiter for authentication endpoints (login, register, OTP
 * verify/resend, password reset) - the classic brute-force/credential-
 * stuffing/fake-account-spam surface. Keyed by IP (the default), since
 * these routes run before a user is authenticated and there's no other
 * identity to key on yet.
 *
 * In tests (`NODE_ENV=test`, set by Vitest) the limit is raised well above
 * anything a real test file would hit rather than disabled outright, so a
 * regression that made a route call this dramatically more often than
 * expected would still eventually surface as a failure - mirrors how
 * `testDb.ts` force-clears `METALS_API_KEY` to keep an orthogonal concern
 * (there, a real network call; here, IP throttling) from interfering with
 * whatever the test is actually exercising. The auth module's own
 * per-OTP-code `attempts` cap (see `auth.service.ts`) is what actually
 * guards against OTP brute-forcing in tests, independent of this limiter.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.nodeEnv === "test" ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

/**
 * Dedicated, tighter IP-based limiter for the OTP resend action
 * specifically, stacked on top of (not instead of) `authRateLimiter` on
 * that route. Resending costs a real SMS (via Twilio) and, since OTP codes
 * no longer expire (see `OtpCode`'s doc comment in schema.prisma),
 * requesting a fresh code is the main lever left for repeated abuse -
 * warrants its own stricter budget rather than sharing the general auth
 * limiter's more generous one. This is a *different* layer from
 * `auth.service.ts`'s `resendOtp()` per-account cooldown: this one is
 * keyed by IP and caps total resend volume; the cooldown is keyed by
 * account and enforces spacing between individual requests regardless of
 * which IP they come from.
 */
export const otpResendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.nodeEnv === "test" ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many code requests. Please wait before trying again." },
});

/**
 * Dedicated, more generous limiter for `/auth/refresh` and `/auth/logout` -
 * deliberately *not* `authRateLimiter`, since that budget (20/15min per IP)
 * is shared with login/register/password-reset and would be a real
 * usability regression here: `/refresh` fires automatically on every
 * access-token expiry (every `JWT_ACCESS_TTL`, 15m by default) and on
 * every tab's initial silent-refresh, so several tabs - or several people
 * behind the same NATed/shared IP - could plausibly exceed 20 refreshes in
 * 15 minutes during entirely normal use, forcing spurious logouts. This
 * limiter exists only to bound genuine hammering/DoS against these two
 * routes (see their route registration for why they need *some* limiter at
 * all), not to throttle legitimate session upkeep.
 */
export const sessionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.nodeEnv === "test" ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
