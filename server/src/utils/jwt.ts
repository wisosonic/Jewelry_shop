import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * JWT access-token signing/verification and opaque refresh-token helpers.
 * Refresh tokens are random opaque strings (not JWTs) whose SHA-256 hash is
 * what gets persisted, so a leaked database never exposes usable tokens.
 */

export type AccessTokenPayload = {
  sub: string;
  role: string;
  email: string | null;
};

/** Signs a short-lived JWT access token for the given user payload. */
export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: env.jwtAccessTtl as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  };
  return jwt.sign(payload, env.jwtAccessSecret, options);
}

/**
 * Verifies and decodes an access token. `algorithms: ["HS256"]` is pinned
 * explicitly (defense-in-depth, not fixing a live bug - `jsonwebtoken`
 * already restricts verification to the HMAC family for a plain string
 * secret and rejects `alg: none`) so a future refactor that swaps in a
 * different key type can't silently reopen an algorithm-confusion risk.
 * @throws {Error} (from `jsonwebtoken`) if the token is invalid or expired.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret, { algorithms: ["HS256"] }) as AccessTokenPayload;
}

/** Generates a new opaque, high-entropy refresh token string. */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

/** Hashes a refresh token with SHA-256 for safe storage/lookup. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Computes the expiry timestamp for a newly issued refresh token. */
export function refreshTokenExpiry(): Date {
  const days = env.jwtRefreshTtlDays;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
