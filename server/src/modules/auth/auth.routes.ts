import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { authRateLimiter, otpResendRateLimiter, sessionRateLimiter } from "../../middleware/rateLimit";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import * as controller from "./auth.controller";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, verifyOtpSchema } from "./auth.schema";

/** Routes for registration, login, session refresh/logout, password reset, and the current user. */
export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  asyncHandler(controller.register)
);
authRouter.post("/login", authRateLimiter, validate({ body: loginSchema }), asyncHandler(controller.login));
// Rate-limited (previously the one gap on this router) - the refresh token
// itself is high-entropy and impractical to brute-force, but an
// unthrottled endpoint is still a cheap DB-hammering DoS vector. Uses the
// dedicated, more generous `sessionRateLimiter` rather than `authRateLimiter`
// - see that limiter's doc comment for why sharing the login/register
// budget here would risk logging real users out under normal use.
authRouter.post("/refresh", sessionRateLimiter, asyncHandler(controller.refresh));
authRouter.post("/logout", sessionRateLimiter, asyncHandler(controller.logout));
authRouter.get("/me", authenticate, asyncHandler(controller.me));

authRouter.post(
  "/forgot-password",
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword)
);
authRouter.post(
  "/reset-password",
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(controller.resetPassword)
);

authRouter.post(
  "/verify-otp",
  authenticate,
  authRateLimiter,
  validate({ body: verifyOtpSchema }),
  asyncHandler(controller.verifyOtp)
);
authRouter.post(
  "/resend-otp",
  authenticate,
  authRateLimiter,
  otpResendRateLimiter,
  asyncHandler(controller.resendOtp)
);
