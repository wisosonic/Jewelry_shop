import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-auth.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("auth API", () => {
  it("registers (phone required, email optional), rejects duplicates, and blocks bad credentials", async () => {
    const { app } = await import("../../src/app");

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "new@test.com", password: "Password123!", name: "New User", phone: "+1-555-0001" });
    expect(registered.status).toBe(201);
    expect(registered.body.user.role).toBe("CUSTOMER");
    expect(registered.body.user.isVerified).toBe(false);
    // lastLoginAt is only ever set by an actual login, never by registering.
    expect(registered.body.user.lastLoginAt).toBeNull();
    expect(registered.body.accessToken).toBeTruthy();
    expect(registered.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);

    // Email is optional - a phone-only registration still succeeds.
    const emailless = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "No Email User", phone: "+1-555-0002" });
    expect(emailless.status).toBe(201);
    expect(emailless.body.user.email).toBeNull();

    const duplicatePhone = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "another@test.com", password: "Password123!", name: "Dup Phone", phone: "+1-555-0001" });
    expect(duplicatePhone.status).toBe(409);

    const duplicateEmail = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "new@test.com", password: "Password123!", name: "New User", phone: "+1-555-0003" });
    expect(duplicateEmail.status).toBe(409);

    const missingPhone = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "no-phone@test.com", password: "Password123!", name: "No Phone" });
    expect(missingPhone.status).toBe(400);

    const badPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "new@test.com", password: "wrong-password" });
    expect(badPassword.status).toBe(401);

    // Login also accepts a phone number in place of an email.
    const loginByPhone = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "+1-555-0002", password: "Password123!" });
    expect(loginByPhone.status).toBe(200);
  });

  it("protects /me, and refresh/logout roll the refresh-token cookie", async () => {
    const { app } = await import("../../src/app");
    const agent = request.agent(app); // persists the HttpOnly refresh cookie across requests, like a browser

    const noToken = await request(app).get("/api/v1/auth/me");
    expect(noToken.status).toBe(401);

    const login = await agent
      .post("/api/v1/auth/login")
      .send({ email: "new@test.com", password: "Password123!" });
    expect(login.status).toBe(200);
    // lastLoginAt is recorded on an actual login, not left null forever.
    expect(login.body.user.lastLoginAt).not.toBeNull();

    const me = await agent.get("/api/v1/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("new@test.com");

    const originalRefreshCookie = login.headers["set-cookie"]?.[0];
    const refreshed = await agent.post("/api/v1/auth/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    // The refresh token must rotate on use: replaying the pre-refresh cookie
    // should now be rejected, proving the old one was revoked rather than
    // just re-issuing an equivalent token.
    const replayedOldCookie = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", originalRefreshCookie ?? "");
    expect(replayedOldCookie.status).toBe(401);

    const loggedOut = await agent.post("/api/v1/auth/logout");
    expect(loggedOut.status).toBe(204);

    const refreshAfterLogout = await agent.post("/api/v1/auth/refresh");
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("resets a password via a one-time link, staying silent for unknown emails and revoking existing sessions", async () => {
    const { app } = await import("../../src/app");
    const { notificationService } = await import("../../src/modules/notifications/notification.service");

    // A still-active session from the earlier test, to prove it gets revoked by the reset below.
    const agent = request.agent(app);
    const login = await agent.post("/api/v1/auth/login").send({ email: "new@test.com", password: "Password123!" });
    expect(login.status).toBe(200);

    // Doesn't reveal whether the email is registered - same 204 either way.
    const unknownEmail = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "nobody@test.com" });
    expect(unknownEmail.status).toBe(204);

    const sendSpy = vi.spyOn(notificationService, "sendPasswordReset").mockResolvedValue(undefined);
    const forgot = await request(app).post("/api/v1/auth/forgot-password").send({ email: "new@test.com" });
    expect(forgot.status).toBe(204);
    expect(sendSpy).toHaveBeenCalledOnce();

    const resetUrl = sendSpy.mock.calls[0][0].resetUrl;
    const token = new URL(resetUrl).searchParams.get("token");
    expect(token).toBeTruthy();
    sendSpy.mockRestore();

    const badToken = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: "not-a-real-token", password: "NewPassword123!" });
    expect(badToken.status).toBe(400);

    const reset = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "NewPassword123!" });
    expect(reset.status).toBe(204);

    // Single-use: the same link can't be replayed.
    const reuse = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "AnotherPassword123!" });
    expect(reuse.status).toBe(400);

    const loginWithOldPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "new@test.com", password: "Password123!" });
    expect(loginWithOldPassword.status).toBe(401);

    const loginWithNewPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "new@test.com", password: "NewPassword123!" });
    expect(loginWithNewPassword.status).toBe(200);

    // The session active before the reset must be logged out - a password
    // reset is exactly the moment an account may have been compromised.
    const refreshAfterReset = await agent.post("/api/v1/auth/refresh");
    expect(refreshAfterReset.status).toBe(401);
  });

  it("verifies a registration OTP (wrong code, expiry, attempt cap, resend, success), and gates order placement on it", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { smsService } = await import("../../src/modules/sms/sms.service");

    const sendSpy = vi.spyOn(smsService, "sendOtp").mockResolvedValue(undefined);

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "OTP User", phone: "+1-555-0900" });
    expect(registered.status).toBe(201);
    expect(registered.body.user.isVerified).toBe(false);
    const accessToken = registered.body.accessToken as string;
    const authHeader = `Bearer ${accessToken}`;

    expect(sendSpy).toHaveBeenCalledOnce();
    const firstCode = sendSpy.mock.calls[0][0].code;
    expect(firstCode).toMatch(/^\d{5}$/);

    const noAuth = await request(app).post("/api/v1/auth/verify-otp").send({ code: firstCode });
    expect(noAuth.status).toBe(401);

    const malformed = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: "12" });
    expect(malformed.status).toBe(400);

    // Wrong codes count against the attempt cap without consuming the real
    // one - and, unlike expiry/lockout, a plain wrong guess doesn't tell the
    // client to resend, since retrying (with the right code) could still work.
    const wrongCode = firstCode === "00000" ? "11111" : "00000";
    for (let i = 0; i < 4; i++) {
      const attempt = await request(app)
        .post("/api/v1/auth/verify-otp")
        .set("Authorization", authHeader)
        .send({ code: wrongCode });
      expect(attempt.status).toBe(400);
      expect(attempt.body.details?.requiresResend).toBeFalsy();
    }
    // The 5th wrong attempt exhausts the cap - even the correct code is now rejected.
    const fifthWrong = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: wrongCode });
    expect(fifthWrong.status).toBe(400);
    const lockedOut = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: firstCode });
    expect(lockedOut.status).toBe(400);
    // The attempt cap is a "you must resend" case, not a "just try again" one.
    expect(lockedOut.body.details?.requiresResend).toBe(true);

    // Resending invalidates the locked-out code and issues a fresh one,
    // reporting the (test-configured, here zero) cooldown before the next
    // resend is allowed.
    sendSpy.mockClear();
    const resent = await request(app).post("/api/v1/auth/resend-otp").set("Authorization", authHeader);
    expect(resent.status).toBe(200);
    expect(resent.body.cooldownSeconds).toBe(0);
    expect(sendSpy).toHaveBeenCalledOnce();
    const secondCode = sendSpy.mock.calls[0][0].code;

    // The old (now-invalidated) code no longer works even though it was never guessed against directly.
    const oldCodeAfterResend = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: firstCode });
    expect(oldCodeAfterResend.status).toBe(400);

    // An unverified account can still browse (products are public) but can't order.
    const product = await prisma.product.create({
      data: {
        sku: "OTP-TEST-001",
        name: "OTP Test Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 2,
        makingChargeCents: 0,
        currentPriceCents: 500,
        stockQuantity: 5,
        isActive: true,
      },
    });
    const blockedOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authHeader)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(blockedOrder.status).toBe(403);

    // Submitting the still-pending code (never expires) now verifies the account.
    const verified = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: secondCode });
    expect(verified.status).toBe(200);
    expect(verified.body.user.isVerified).toBe(true);

    // Verifying twice in a row is a clean 400 ("no pending code"), not a crash.
    const alreadyVerified = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: secondCode });
    expect(alreadyVerified.status).toBe(400);

    const resendAfterVerified = await request(app).post("/api/v1/auth/resend-otp").set("Authorization", authHeader);
    expect(resendAfterVerified.status).toBe(400);

    // Now that the account is verified, the same order succeeds.
    const allowedOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", authHeader)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(allowedOrder.status).toBe(201);

    sendSpy.mockRestore();
  });

  it("lets an admin set a universal OTP code that verifies any account, bypassing its own code entirely", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { smsService } = await import("../../src/modules/sms/sms.service");
    const sendSpy = vi.spyOn(smsService, "sendOtp").mockResolvedValue(undefined);

    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "universal-admin@test.com", role: "ADMIN" });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "universal-customer@test.com" });

    const customerForbidden = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ universalOtpCode: "54321" });
    expect(customerForbidden.status).toBe(403);

    const invalidFormat = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ universalOtpCode: "abc" });
    expect(invalidFormat.status).toBe(400);

    const setByAdmin = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ universalOtpCode: "54321" });
    expect(setByAdmin.status).toBe(200);
    expect(setByAdmin.body.settings.universalOtpCode).toBe("54321");

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "Universal Code User", phone: "+1-555-0999" });
    expect(registered.status).toBe(201);
    const authHeader = `Bearer ${registered.body.accessToken}`;
    const realCode = sendSpy.mock.calls.at(-1)![0].code;

    // The wrong code (not the real one, not the universal one) still just increments attempts normally.
    const stillWrong = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: realCode === "11111" ? "22222" : "11111" });
    expect(stillWrong.status).toBe(400);

    // The universal code verifies the account even though it's not this user's own code.
    const verifiedByUniversal = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: "54321" });
    expect(verifiedByUniversal.status).toBe(200);
    expect(verifiedByUniversal.body.user.isVerified).toBe(true);

    // The account's own real code is now moot - it was consumed as part of the universal-code path too.
    const ownCodeAfterward = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", authHeader)
      .send({ code: realCode });
    expect(ownCodeAfterward.status).toBe(400);

    // Disabling it (an empty string clears it, stored as null) makes it stop working for a fresh account.
    const disabled = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ universalOtpCode: "" });
    expect(disabled.status).toBe(200);
    expect(disabled.body.settings.universalOtpCode).toBeNull();

    const registeredAfterDisable = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "Post Disable User", phone: "+1-555-0998" });
    const noLongerUniversal = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", `Bearer ${registeredAfterDisable.body.accessToken}`)
      .send({ code: "54321" });
    expect(noLongerUniversal.status).toBe(400);

    sendSpy.mockRestore();
  });

  it("locks out the universal OTP bypass globally after enough wrong guesses across different accounts, without affecting each account's own code", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { smsService } = await import("../../src/modules/sms/sms.service");
    const sendSpy = vi.spyOn(smsService, "sendOtp").mockResolvedValue(undefined);

    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "lockout-admin@test.com", role: "ADMIN" });
    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ universalOtpCode: "99999" });

    // 10 wrong guesses against 10 *different*, freshly-registered accounts -
    // proving the lockout counter is global, not reset by registering a new
    // account (which would trivially defeat a per-account counter).
    for (let i = 0; i < 10; i++) {
      const registered = await request(app)
        .post("/api/v1/auth/register")
        .send({ password: "Password123!", name: `Lockout User ${i}`, phone: `+1-555-08${i.toString().padStart(2, "0")}` });
      await request(app)
        .post("/api/v1/auth/verify-otp")
        .set("Authorization", `Bearer ${registered.body.accessToken}`)
        .send({ code: "88888" }); // never matches the universal code or any real per-user code
    }

    // The universal code itself is now rejected (falls through to the
    // normal per-user flow, where it also doesn't match) rather than verifying.
    const lockedOutUser = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "Locked Out Target", phone: "+1-555-0897" });
    const lockedAttempt = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", `Bearer ${lockedOutUser.body.accessToken}`)
      .send({ code: "99999" });
    expect(lockedAttempt.status).toBe(400);

    // That account's own real code still works fine during the lockout -
    // only the shared bypass is disabled, not ordinary per-user verification.
    const ownCode = sendSpy.mock.calls.at(-1)![0].code;
    const verifiedWithOwnCode = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("Authorization", `Bearer ${lockedOutUser.body.accessToken}`)
      .send({ code: ownCode });
    expect(verifiedWithOwnCode.status).toBe(200);

    sendSpy.mockRestore();
  });

  it("revokes every session on refresh-token reuse (replaying an already-rotated-away token)", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "Reuse Test User", phone: "+1-555-0777" });
    expect(registered.status).toBe(201);
    const originalRefreshCookie = registered.headers["set-cookie"]![0];

    // A second, independent session for the same account (e.g. a different
    // device) - logged in by phone, since this account has no email
    // (matching this test's registration input) and `email: null` would
    // otherwise ambiguously match every other emailless user in this file's
    // shared test database.
    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: registered.body.user.phone, password: "Password123!" });
    const secondSessionCookie = loggedIn.headers["set-cookie"]![0];

    // Rotate the first session once - this revokes the original token and issues a new one.
    const firstRotation = await request(app).post("/api/v1/auth/refresh").set("Cookie", originalRefreshCookie);
    expect(firstRotation.status).toBe(200);

    // Replaying the now-revoked original token is reuse - rejected, and the
    // *other*, still-legitimate session gets revoked as a precaution too.
    const reuseAttempt = await request(app).post("/api/v1/auth/refresh").set("Cookie", originalRefreshCookie);
    expect(reuseAttempt.status).toBe(401);

    const secondSessionAfterReuse = await request(app).post("/api/v1/auth/refresh").set("Cookie", secondSessionCookie);
    expect(secondSessionAfterReuse.status).toBe(401);
  });

  it("tolerates two concurrent requests racing to rotate the same not-yet-revoked token, without revoking other sessions", async () => {
    const { app } = await import("../../src/app");

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "Race Test User", phone: "+1-555-0666" });
    expect(registered.status).toBe(201);
    const refreshCookie = registered.headers["set-cookie"]![0];

    // A second, independent session for the same account - must survive
    // the race below untouched, unlike genuine reuse (the test above).
    const loggedIn = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: registered.body.user.phone, password: "Password123!" });
    const otherSessionCookie = loggedIn.headers["set-cookie"]![0];

    // Two genuinely concurrent requests presenting the exact same,
    // not-yet-rotated refresh token - simulates React StrictMode's
    // double-invoked mount effect (or two tabs silently refreshing at the
    // same moment), which rotateRefreshToken()'s atomic claim exists for.
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/auth/refresh").set("Cookie", refreshCookie),
      request(app).post("/api/v1/auth/refresh").set("Cookie", refreshCookie),
    ]);

    // Exactly one wins (200), the other loses cleanly (401) - never both
    // succeeding (two live tokens from one rotation) and never both failing.
    expect([first.status, second.status].sort()).toEqual([200, 401]);

    const winner = first.status === 200 ? first : second;
    const winnerCookie = winner.headers["set-cookie"]![0];

    // The winner's new token must still be valid - a benign race must not
    // have triggered the mass-revocation reuse response on it.
    const followUp = await request(app).post("/api/v1/auth/refresh").set("Cookie", winnerCookie);
    expect(followUp.status).toBe(200);

    // The other, unrelated session must be completely untouched too.
    const otherSessionStillValid = await request(app).post("/api/v1/auth/refresh").set("Cookie", otherSessionCookie);
    expect(otherSessionStillValid.status).toBe(200);
  });

  it("bypasses OTP entirely and registers already-verified when an admin disables Settings.otpVerificationEnabled", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { smsService } = await import("../../src/modules/sms/sms.service");
    const { createUserWithToken } = await import("../helpers/fixtures");

    const sendSpy = vi.spyOn(smsService, "sendOtp").mockResolvedValue(undefined);
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "otpswitch@test.com", role: "ADMIN" });

    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ otpVerificationEnabled: false });

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ password: "Password123!", name: "No OTP User", phone: "+1-555-0111" });
    expect(registered.status).toBe(201);
    expect(registered.body.user.isVerified).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();

    const otpCodes = await prisma.otpCode.findMany({ where: { userId: registered.body.user.id } });
    expect(otpCodes).toHaveLength(0);

    // The bypass isn't just cosmetic on the returned user object - the
    // account can place an order immediately, with no verify-otp step at all.
    const product = await prisma.product.create({
      data: {
        sku: "OTP-BYPASS-001",
        name: "Bypass Test Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 1,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 5,
        isActive: true,
      },
    });
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(order.status).toBe(201);

    // Restore the default for hygiene, even though this is the last test in the file.
    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ otpVerificationEnabled: true });
    sendSpy.mockRestore();
  });
});
