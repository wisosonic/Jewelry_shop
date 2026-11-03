import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";
import { verifyAccessToken } from "../utils/jwt";

/**
 * Authentication and role-based authorization middleware. Reads the bearer
 * access token from the `Authorization` header and attaches the decoded
 * user identity to `req.user` for downstream handlers.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: string; email: string | null };
    }
  }
}

/**
 * Verifies the `Bearer` access token on the request and populates
 * `req.user` with the decoded identity.
 * @throws {AppError} 401 if the header is missing, or the token is invalid/expired.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(AppError.unauthorized("Missing access token"));
  }
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch {
    next(AppError.unauthorized("Invalid or expired access token"));
  }
}

/**
 * Like {@link authenticate}, but never rejects the request - it populates
 * `req.user` when a valid Bearer token is present, and just leaves it
 * `undefined` otherwise (missing header, malformed, expired, invalid).
 * For public routes that legitimately serve anonymous visitors but need to
 * behave slightly differently for a *recognized* admin without forcing
 * every visitor to authenticate - e.g. `GET /products`'s `includeInactive`
 * flag, which must only ever be honored for an admin, even though the
 * route itself stays open to anonymous browsing.
 */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
  } catch {
    // Invalid/expired token on an optional-auth route - proceed as anonymous rather than erroring.
  }
  next();
}

/**
 * Creates middleware that restricts access to users whose role is in `roles`.
 * Must run after {@link authenticate}.
 *
 * `SUPER_ADMIN` implicitly satisfies any check that lists `"ADMIN"` - it has
 * every `ADMIN` permission plus more (see `utils/roles.ts` and CLAUDE.md's
 * `SUPER_ADMIN` bullet) - so a route gated with just `authorize("ADMIN")`
 * only needs to say so once, here, rather than every one of this app's
 * ~20 admin-only route registrations remembering to also list
 * `"SUPER_ADMIN"`. There is currently no route that needs `SUPER_ADMIN`
 * *without* also allowing plain `ADMIN`, so no reverse case exists.
 * @throws {AppError} 401 if unauthenticated, 403 if the user's role isn't allowed.
 */
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    const userRole = req.user.role;
    const allowed = roles.includes(userRole) || (userRole === "SUPER_ADMIN" && roles.includes("ADMIN"));
    if (!allowed) return next(AppError.forbidden());
    next();
  };
}
