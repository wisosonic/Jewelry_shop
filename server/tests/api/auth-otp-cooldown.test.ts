import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

// A short-but-real, non-zero cooldown (unlike the other auth test file,
// which sets it to 0 so its own unrelated resend calls aren't throttled) -
// see setupTestDatabase()'s doc comment for why this can only be set once,
// for this whole file, before the first dynamic `import("../../src/app")`.
const COOLDOWN_SECONDS = 1;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-auth-otp-cooldown.db", { otpResendCooldownSeconds: COOLDOWN_SECONDS });
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("OTP resend cooldown", () => {
  it("rejects a resend within the cooldown window (with the remaining wait time) and allows it again once the cooldown elapses", async () => {
    const { app } = await import("../../src/app");
    const { smsService } = await import("../../src/modules/sms/sms.service");
    const sendSpy = vi.spyOn(smsService, "sendOtp").mockResolvedValue(undefined);

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "Cooldown User", phone: "+1-555-0950" });
    expect(registered.status).toBe(201);
    const authHeader = `Bearer ${registered.body.accessToken}`;

    // Registration itself just issued a code, so an immediate resend is within the cooldown.
    const tooSoon = await request(app).post("/api/v1/auth/resend-otp").set("Authorization", authHeader);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(tooSoon.body.details?.retryAfterSeconds).toBeLessThanOrEqual(COOLDOWN_SECONDS);

    // A second resend attempt, still within the window, is rejected the same way - not somehow "used up" by the first rejection.
    const stillTooSoon = await request(app).post("/api/v1/auth/resend-otp").set("Authorization", authHeader);
    expect(stillTooSoon.status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, COOLDOWN_SECONDS * 1000 + 100));

    sendSpy.mockClear();
    const resent = await request(app).post("/api/v1/auth/resend-otp").set("Authorization", authHeader);
    expect(resent.status).toBe(200);
    expect(resent.body.cooldownSeconds).toBe(COOLDOWN_SECONDS);
    expect(sendSpy).toHaveBeenCalledOnce();

    // The just-issued code immediately starts its own cooldown.
    const tooSoonAgain = await request(app).post("/api/v1/auth/resend-otp").set("Authorization", authHeader);
    expect(tooSoonAgain.status).toBe(429);

    sendSpy.mockRestore();
  });
});
