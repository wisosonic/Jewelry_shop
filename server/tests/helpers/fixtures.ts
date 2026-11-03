import type { PrismaClient } from "@prisma/client";

/**
 * Test-only helper: creates a user directly in the database and mints a
 * valid access token for it, bypassing the HTTP register/login flow so
 * tests that aren't specifically about auth can act as a given role in one
 * step. Uses dynamic imports internally (rather than importing at module
 * top-level) so this file can be statically imported by test files without
 * pulling in `config/env` before {@link setupTestDatabase} has set
 * DATABASE_URL/JWT secrets for that file.
 */
export async function createUserWithToken(
  prisma: PrismaClient,
  opts: { email: string; role?: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN"; name?: string; phone?: string; isVerified?: boolean }
) {
  const { hashPassword } = await import("../../src/utils/password");
  const { signAccessToken } = await import("../../src/utils/jwt");

  const user = await prisma.user.create({
    data: {
      email: opts.email,
      passwordHash: await hashPassword("Password123!"),
      name: opts.name ?? "Test User",
      role: opts.role ?? "CUSTOMER",
      phone: opts.phone,
      // Defaults true (verified) so existing tests using this fixture for
      // roles/RBAC keep working unchanged - pass `isVerified: false`
      // explicitly to test the OTP-gated-purchase behavior.
      isVerified: opts.isVerified ?? true,
    },
  });
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  return { user, accessToken };
}
