import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Same isolated-throwaway-DB pattern as tests/orderSnapshot.test.ts - this
// is a direct service-level test (no HTTP layer, since account cleanup has
// no route), so it needs the same manual DB setup that helper does for
// non-`tests/api/*` files.
const TEST_DB_PATH = path.join(__dirname, "test-account-cleanup.db");
const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

beforeAll(() => {
  for (const suffix of ["", "-journal"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.TWILIO_ACCOUNT_SID = "";
  process.env.TWILIO_AUTH_TOKEN = "";
  process.env.TWILIO_PHONE_NUMBER = "";

  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
});

afterAll(async () => {
  const { prisma } = await import("../src/db/prisma");
  await prisma.$disconnect();
  for (const suffix of ["", "-journal"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("unverified-account cleanup", () => {
  it("warns accounts in the warning window (once), and deletes only accounts past the full TTL - leaving fresh and verified accounts untouched", async () => {
    const { prisma } = await import("../src/db/prisma");
    const { sendDeletionWarnings, deleteExpiredUnverifiedAccounts } = await import(
      "../src/modules/accountCleanup/accountCleanup.service"
    );

    const now = Date.now();
    // Defaults: TTL = 14 days, warn 3 days before -> warning window is [11, 14) days old.
    const fresh = await prisma.user.create({
      data: { name: "Fresh", phone: "+1-555-2001", passwordHash: "x", isVerified: false, createdAt: new Date(now - 1 * DAY_MS) },
    });
    const warnable = await prisma.user.create({
      data: {
        name: "Warnable",
        phone: "+1-555-2002",
        email: "warnable@test.com",
        passwordHash: "x",
        isVerified: false,
        createdAt: new Date(now - 12 * DAY_MS),
      },
    });
    const expired = await prisma.user.create({
      data: { name: "Expired", phone: "+1-555-2003", passwordHash: "x", isVerified: false, createdAt: new Date(now - 15 * DAY_MS) },
    });
    const oldButVerified = await prisma.user.create({
      data: { name: "Old Verified", phone: "+1-555-2004", passwordHash: "x", isVerified: true, createdAt: new Date(now - 20 * DAY_MS) },
    });

    const warnedCount = await sendDeletionWarnings();
    expect(warnedCount).toBe(1);

    const warnedUser = await prisma.user.findUniqueOrThrow({ where: { id: warnable.id } });
    expect(warnedUser.deletionWarningSentAt).not.toBeNull();

    // The warning is delivered as an in-app notification (see the
    // "regular users get no external channel" rule in CLAUDE.md) - not SMS
    // or email, even though this account has both a phone and an email.
    const notifications = await prisma.notification.findMany({ where: { userId: warnable.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "ACCOUNT_DELETION_WARNING",
      link: "/verify-otp",
    });
    expect(notifications[0].message).toContain("3 day(s)");

    // Running it again the same "day" doesn't re-warn (deletionWarningSentAt is now set).
    const warnedAgainCount = await sendDeletionWarnings();
    expect(warnedAgainCount).toBe(0);
    expect(await prisma.notification.count({ where: { userId: warnable.id } })).toBe(1);

    const deletedCount = await deleteExpiredUnverifiedAccounts();
    expect(deletedCount).toBe(1);

    expect(await prisma.user.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: warnable.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: oldButVerified.id } })).not.toBeNull();
  });
});
