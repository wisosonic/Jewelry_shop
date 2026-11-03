import crypto from "node:crypto";

const OTP_LENGTH = 5;

/** Generates a cryptographically-random 5-digit numeric OTP code as a zero-padded string (e.g. "00042"). */
export function generateOtpCode(): string {
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}
