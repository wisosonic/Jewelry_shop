import { Request, Response } from "express";
import { env } from "../../config/env";
import * as authService from "./auth.service";

/**
 * HTTP handlers for registration, login, token refresh/logout, and the
 * current-user endpoint. The refresh token is issued as an httpOnly cookie
 * scoped to the auth routes; the access token is returned in the response body.
 */

const REFRESH_COOKIE = "refreshToken";

/**
 * Builds the cookie options used when setting/clearing the refresh token
 * cookie. `secure` doesn't rely on `NODE_ENV` alone - an ops mistake that
 * forgets to set `NODE_ENV=production` would otherwise silently downgrade
 * this to a non-Secure cookie - it's also true whenever the request itself
 * actually arrived over HTTPS (`req.secure`). Note `req.secure` only
 * reflects a *direct* HTTPS connection to this Node process unless
 * `app.set("trust proxy", ...)` is configured for a reverse-proxy
 * deployment (see the deployment notes in README.md) - set that explicitly
 * once you know your actual proxy topology, rather than assuming it here.
 */
function refreshCookieOptions(req: Request) {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production" || req.secure,
    sameSite: "lax" as const,
    maxAge: env.jwtRefreshTtlDays * 24 * 60 * 60 * 1000,
    path: "/api/v1/auth",
  };
}

/** Creates a new customer account and starts a session for them. */
export async function register(req: Request, res: Response) {
  const { accessToken, refreshToken, user } = await authService.registerUser(req.body);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(req));
  res.status(201).json({ accessToken, user });
}

/** Authenticates a user by email/password and starts a session. */
export async function login(req: Request, res: Response) {
  const { accessToken, refreshToken, user } = await authService.loginUser(
    req.body.email,
    req.body.password
  );
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(req));
  res.json({ accessToken, user });
}

/** Rotates the refresh token cookie and issues a new access token. */
export async function refresh(req: Request, res: Response) {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) {
    res.status(401).json({ error: "Missing refresh token" });
    return;
  }
  const { accessToken, refreshToken, user } = await authService.rotateRefreshToken(presented);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(req));
  res.json({ accessToken, user });
}

/** Revokes the presented refresh token and clears its cookie. */
export async function logout(req: Request, res: Response) {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (presented) await authService.revokeRefreshToken(presented);
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  res.status(204).send();
}

/** Returns the profile of the currently authenticated user. */
export async function me(req: Request, res: Response) {
  const user = await authService.getUserById(req.user!.id);
  res.json({ user });
}

/** Starts a password reset for the given email, if it belongs to an account. Always responds the same way either way. */
export async function forgotPassword(req: Request, res: Response) {
  await authService.requestPasswordReset(req.body.email);
  res.status(204).send();
}

/** Completes a password reset using a token from the reset email. */
export async function resetPassword(req: Request, res: Response) {
  await authService.resetPassword(req.body.token, req.body.password);
  res.status(204).send();
}

/** Verifies a registration OTP code and activates the account on success. */
export async function verifyOtp(req: Request, res: Response) {
  await authService.verifyOtp(req.user!.id, req.body.code);
  const user = await authService.getUserById(req.user!.id);
  res.json({ user });
}

/** Sends a fresh registration OTP code, invalidating any previous one; responds with how long until the next resend is allowed. */
export async function resendOtp(req: Request, res: Response) {
  const result = await authService.resendOtp(req.user!.id);
  res.json(result);
}
