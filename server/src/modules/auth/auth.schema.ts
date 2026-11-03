import { z } from "zod";

/**
 * Request body schema for account registration. `phone` is required (it's
 * how the OTP verification code is delivered - see auth.service.ts's
 * registerUser()); `email` is optional.
 */
export const registerSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  name: z.string().min(1),
  phone: z.string().min(1, "Phone number is required"),
  address: z.string().optional(),
});

/**
 * Request body schema for login. The `email` field accepts either an email
 * address or a phone number - now that registration allows an emailless
 * account (see `registerSchema`), login has to work for those accounts too,
 * so `auth.service.ts`'s `loginUser()` looks up by whichever field matches.
 * Kept as one field (not split into `email`/`phone`) so the client's
 * existing login form/wire shape didn't need to change - only its label.
 */
export const loginSchema = z.object({
  email: z.string().min(1, "Email or phone number is required"),
  password: z.string().min(1),
});

/** Request body schema for starting a password reset. */
export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

/** Request body schema for completing a password reset. */
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

/** Request body schema for submitting a registration OTP code. */
export const verifyOtpSchema = z.object({
  code: z.string().regex(/^\d{5}$/, "Enter the 5-digit code"),
});
