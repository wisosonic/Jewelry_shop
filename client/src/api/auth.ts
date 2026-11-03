import { api } from "../lib/api";
import type { User } from "../types";

/** API wrappers for the forgot/reset-password flow and registration OTP verification. */

/** Requests a password-reset email; always resolves, even for an unknown address, so as not to leak which emails are registered. */
export async function requestPasswordReset(email: string) {
  await api.post("/auth/forgot-password", { email });
}

/** Resets a password using the one-time token from the reset email. */
export async function resetPassword(token: string, password: string) {
  await api.post("/auth/reset-password", { token, password });
}

/** Submits a registration OTP code; on success the account becomes verified. Requires the caller's own access token (set by `login()`/`register()`). */
export async function verifyOtp(code: string) {
  const { data } = await api.post<{ user: User }>("/auth/verify-otp", { code });
  return data.user;
}

/** Requests a fresh registration OTP code, invalidating any previous one. Returns how long (in seconds) before another resend is allowed - the server enforces a cooldown, this is just for the client's countdown display. */
export async function resendOtp() {
  const { data } = await api.post<{ cooldownSeconds: number }>("/auth/resend-otp");
  return data;
}
