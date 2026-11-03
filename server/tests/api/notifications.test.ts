import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-notifications.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("notifications API", () => {
  it("requires authentication", async () => {
    const { app } = await import("../../src/app");
    const res = await request(app).get("/api/v1/notifications");
    expect(res.status).toBe(401);
  });

  it("lists, counts, and marks a caller's own notifications read - scoped away from other users", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { createNotification } = await import("../../src/modules/notifications/inAppNotifications.service");
    const { accessToken: aliceToken, user: alice } = await createUserWithToken(prisma, { email: "alice-notif@test.com" });
    const { accessToken: bobToken } = await createUserWithToken(prisma, { email: "bob-notif@test.com" });

    // Neither user has a preference row yet, so both default to enabled -
    // createNotification() only ever returns null when the recipient has
    // explicitly disabled the category (see the customer-preferences test below).
    const n1 = await createNotification({ userId: alice.id, type: "ORDER_CONFIRMED", message: "Order 1 confirmed", link: "/orders/1" });
    if (!n1) throw new Error("expected a notification, got null");
    await createNotification({ userId: alice.id, type: "ORDER_STATUS_UPDATED", message: "Order 1 shipped" });

    const unreadCount = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${aliceToken}`);
    expect(unreadCount.status).toBe(200);
    expect(unreadCount.body).toEqual({ count: 2 });

    const list = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${aliceToken}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items).toHaveLength(2);

    // Bob has no notifications of his own - the list/count are scoped per caller.
    const bobList = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${bobToken}`);
    expect(bobList.body.total).toBe(0);
    const bobCount = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${bobToken}`);
    expect(bobCount.body).toEqual({ count: 0 });

    // Bob can't mark Alice's notification read.
    const forbiddenMarkRead = await request(app)
      .patch(`/api/v1/notifications/${n1.id}/read`)
      .set("Authorization", `Bearer ${bobToken}`);
    expect(forbiddenMarkRead.status).toBe(403);

    const markRead = await request(app)
      .patch(`/api/v1/notifications/${n1.id}/read`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(markRead.status).toBe(200);
    expect(markRead.body.notification.isRead).toBe(true);

    const countAfterOneRead = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${aliceToken}`);
    expect(countAfterOneRead.body).toEqual({ count: 1 });

    const markAllRead = await request(app).patch("/api/v1/notifications/read-all").set("Authorization", `Bearer ${aliceToken}`);
    expect(markAllRead.status).toBe(204);

    const countAfterAllRead = await request(app).get("/api/v1/notifications/unread-count").set("Authorization", `Bearer ${aliceToken}`);
    expect(countAfterAllRead.body).toEqual({ count: 0 });
  });

  it("deletes one of the caller's own notifications, but not someone else's, and supports clearing all at once", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { createNotification } = await import("../../src/modules/notifications/inAppNotifications.service");
    const { accessToken: aliceToken, user: alice } = await createUserWithToken(prisma, { email: "alice-delete@test.com" });
    const { accessToken: bobToken } = await createUserWithToken(prisma, { email: "bob-delete@test.com" });

    const n1 = await createNotification({ userId: alice.id, type: "ORDER_CONFIRMED", message: "Order 1 confirmed" });
    const n2 = await createNotification({ userId: alice.id, type: "ORDER_STATUS_UPDATED", message: "Order 1 shipped" });
    if (!n1 || !n2) throw new Error("expected notifications, got null");

    // Bob can't delete Alice's notification.
    const forbiddenDelete = await request(app)
      .delete(`/api/v1/notifications/${n1.id}`)
      .set("Authorization", `Bearer ${bobToken}`);
    expect(forbiddenDelete.status).toBe(403);

    // Deleting an unknown id is a clean 404, not a crash.
    const missingDelete = await request(app)
      .delete("/api/v1/notifications/does-not-exist")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(missingDelete.status).toBe(404);

    const deleteOne = await request(app)
      .delete(`/api/v1/notifications/${n1.id}`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(deleteOne.status).toBe(204);
    expect(await prisma.notification.findUnique({ where: { id: n1.id } })).toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: n2.id } })).not.toBeNull();

    const clearAll = await request(app).delete("/api/v1/notifications").set("Authorization", `Bearer ${aliceToken}`);
    expect(clearAll.status).toBe(204);
    expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(0);
  });

  it("rejects a non-admin from every admin-only notification route", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken } = await createUserWithToken(prisma, { email: "customer-notif@test.com" });

    const getPrefs = await request(app).get("/api/v1/notifications/admin-preferences").set("Authorization", `Bearer ${accessToken}`);
    expect(getPrefs.status).toBe(403);

    const patchPrefs = await request(app)
      .patch("/api/v1/notifications/admin-preferences")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ eventType: "LOW_STOCK", enabled: true, channel: "EMAIL" });
    expect(patchPrefs.status).toBe(403);

    const patchMessaging = await request(app)
      .patch("/api/v1/notifications/messaging-enabled")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ enabled: true });
    expect(patchMessaging.status).toBe(403);

    const broadcast = await request(app)
      .post("/api/v1/notifications/broadcast")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ message: "Sale!" });
    expect(broadcast.status).toBe(403);
  });

  it("lets an admin read/update their own preferences, defaulted until first edited", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken } = await createUserWithToken(prisma, { email: "admin-notif@test.com", role: "ADMIN" });

    const defaults = await request(app).get("/api/v1/notifications/admin-preferences").set("Authorization", `Bearer ${accessToken}`);
    expect(defaults.status).toBe(200);
    expect(defaults.body.messagingEnabled).toBe(false);
    expect(defaults.body.preferences).toEqual(
      expect.arrayContaining([
        { eventType: "USER_SIGNUP", enabled: true, channel: "NONE" },
        { eventType: "LOW_STOCK", enabled: true, channel: "NONE" },
        { eventType: "CRITICAL_ERROR", enabled: true, channel: "NONE" },
        { eventType: "NEW_ORDER", enabled: true, channel: "NONE" },
      ])
    );

    const updated = await request(app)
      .patch("/api/v1/notifications/admin-preferences")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ eventType: "LOW_STOCK", enabled: false, channel: "SMS" });
    expect(updated.status).toBe(200);
    expect(updated.body.preferences).toEqual(
      expect.arrayContaining([{ eventType: "LOW_STOCK", enabled: false, channel: "SMS" }])
    );

    const messaging = await request(app)
      .patch("/api/v1/notifications/messaging-enabled")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ enabled: true });
    expect(messaging.status).toBe(200);
    expect(messaging.body.messagingEnabled).toBe(true);
  });

  it("broadcasts to one target user, or to every customer when none is given - never to admins", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "broadcaster@test.com", role: "ADMIN" });
    const { accessToken: aliceToken, user: alice } = await createUserWithToken(prisma, { email: "alice-broadcast@test.com" });
    await createUserWithToken(prisma, { email: "bob-broadcast@test.com" });

    const single = await request(app)
      .post("/api/v1/notifications/broadcast")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ message: "Just for you", userId: alice.id });
    expect(single.status).toBe(201);
    expect(single.body).toEqual({ notifiedCount: 1 });

    const aliceInbox = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${aliceToken}`);
    expect(aliceInbox.body.items.map((n: { type: string }) => n.type)).toContain("PROMOTION");

    const broadcastAll = await request(app)
      .post("/api/v1/notifications/broadcast")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ message: "Storewide sale!" });
    expect(broadcastAll.status).toBe(201);
    // Every CUSTOMER-role user created across this file's tests gets one, so
    // assert it's at least the two just created here rather than an exact count.
    expect(broadcastAll.body.notifiedCount).toBeGreaterThanOrEqual(2);
  });

  it("lets any authenticated user read/update their own customer-facing preferences, defaulted until first edited", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken } = await createUserWithToken(prisma, { email: "prefs-customer@test.com" });

    const defaults = await request(app).get("/api/v1/notifications/preferences").set("Authorization", `Bearer ${accessToken}`);
    expect(defaults.status).toBe(200);
    expect(defaults.body.preferences).toEqual(
      expect.arrayContaining([
        { eventType: "ORDER_UPDATES", enabled: true },
        { eventType: "ACCOUNT_ACTIVITY", enabled: true },
        { eventType: "PROMOTION", enabled: true },
        { eventType: "ACCOUNT_DELETION_WARNING", enabled: true },
        { eventType: "WISHLIST_BACK_IN_STOCK", enabled: true },
      ])
    );
    // No channel is ever exposed to a customer - unlike the admin preferences shape above.
    expect(defaults.body.preferences[0].channel).toBeUndefined();

    const disabled = await request(app)
      .patch("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ eventType: "ORDER_UPDATES", enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.preferences).toEqual(
      expect.arrayContaining([{ eventType: "ORDER_UPDATES", enabled: false }])
    );
  });

  it("suppresses a notification entirely (not even the row) once the recipient disables its category", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { createNotification } = await import("../../src/modules/notifications/inAppNotifications.service");
    const { accessToken, user } = await createUserWithToken(prisma, { email: "suppressed@test.com" });

    await request(app)
      .patch("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ eventType: "WISHLIST_BACK_IN_STOCK", enabled: false });

    const suppressed = await createNotification({
      userId: user.id,
      type: "WISHLIST_BACK_IN_STOCK",
      message: "Back in stock!",
    });
    expect(suppressed).toBeNull();

    const stillDelivered = await createNotification({
      userId: user.id,
      type: "PROMOTION",
      message: "Unrelated category, still enabled",
    });
    expect(stillDelivered).not.toBeNull();

    expect(await prisma.notification.count({ where: { userId: user.id, type: "WISHLIST_BACK_IN_STOCK" } })).toBe(0);
  });

  it("fires an account-activity notification for a new login, a password change, and a profile edit", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { hashPassword } = await import("../../src/utils/password");
    const user = await prisma.user.create({
      data: { name: "Activity Test", email: "activity@test.com", passwordHash: await hashPassword("Password123!") },
    });

    const login = await request(app).post("/api/v1/auth/login").send({ email: "activity@test.com", password: "Password123!" });
    expect(login.status).toBe(200);
    const token = login.body.accessToken as string;

    const passwordChange = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "Password123!", password: "NewPassword456!" });
    expect(passwordChange.status).toBe(200);

    const profileEdit = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ address: "123 New Address" });
    expect(profileEdit.status).toBe(200);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    const types = notifications.map((n) => n.type);
    expect(types).toContain("NEW_LOGIN");
    expect(types).toContain("PASSWORD_CHANGED");
    expect(types).toContain("PROFILE_UPDATED");
  });

  it("notifies every admin when a new order is placed", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { user: admin } = await createUserWithToken(prisma, { email: "orderadmin@test.com", role: "ADMIN" });
    const { accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "orderplacer@test.com",
      isVerified: true,
    });

    const product = await prisma.product.create({
      data: {
        sku: "NEW-ORDER-NOTIF",
        name: "Notify Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 0,
        currentPriceCents: 5000,
        stockQuantity: 10,
        isActive: true,
      },
    });

    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(order.status).toBe(201);

    const adminNotifications = await prisma.notification.findMany({ where: { userId: admin.id, type: "NEW_ORDER" } });
    expect(adminNotifications).toHaveLength(1);
    expect(adminNotifications[0].message).toContain("$50.00");
  });
});
