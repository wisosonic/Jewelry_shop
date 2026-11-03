import bcrypt from "bcryptjs";

/** Password hashing/verification helpers used by auth and user management. */

// bcrypt (via bcryptjs, a pure-JS implementation) is used instead of Argon2id
// to avoid native-addon build tooling on Windows dev machines. Cost factor 12
// is OWASP's current floor recommendation for bcrypt.
const SALT_ROUNDS = 12;

/** Hashes a plaintext password with bcrypt (cost factor 12). */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Checks a plaintext password against a stored bcrypt hash. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
