import { NextFunction, Request, Response } from "express";
import { notifyAdminsOfEvent } from "../modules/notifications/inAppNotifications.service";
import { AppError } from "../utils/AppError";

/**
 * Express middleware/error-handling for requests that fall through every
 * route (404) and for centralizing error responses across the app.
 */

/** Catch-all for any request that doesn't match a route; forwards a 404 AppError. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound("Route not found"));
}

/**
 * Final Express error handler. Converts {@link AppError} instances into their
 * intended HTTP status/body, and logs and masks any other error as a 500.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }
  console.error(err);
  // Fire-and-forget: notifying admins of an unexpected error must never
  // delay or risk the 500 response itself (notifyAdminsOfEvent already
  // swallows its own errors, `.catch()` here is just belt-and-suspenders
  // against something throwing synchronously before that).
  notifyAdminsOfEvent("CRITICAL_ERROR", {
    message: `Unhandled server error: ${err instanceof Error ? err.message : "unknown error"}`,
  }).catch(() => {});
  res.status(500).json({ error: "Internal server error" });
}
