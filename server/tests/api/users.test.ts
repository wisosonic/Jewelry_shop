import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-users.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("users API", () => {
  it("lets users manage their own profile but restricts admin-only actions", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, { email: "self@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "admin@test.com", role: "ADMIN" });
    const { accessToken: otherToken } = await createUserWithToken(prisma, { email: "other@test.com" });

    const listForbidden = await request(app).get("/api/v1/users").set("Authorization", `Bearer ${customerToken}`);
    expect(listForbidden.status).toBe(403);

    const listAsAdmin = await request(app).get("/api/v1/users").set("Authorization", `Bearer ${adminToken}`);
    expect(listAsAdmin.status).toBe(200);
    expect(listAsAdmin.body.items.length).toBeGreaterThanOrEqual(3);

    // A customer can edit their own name, but a smuggled `role` or
    // `adminNotes` field must be silently dropped, and the response must
    // never include `adminNotes` for a self-view.
    const selfUpdate = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name: "Updated Name", role: "ADMIN", adminNotes: "smuggled note" });
    expect(selfUpdate.status).toBe(200);
    expect(selfUpdate.body.user.name).toBe("Updated Name");
    expect(selfUpdate.body.user.role).toBe("CUSTOMER");
    expect(selfUpdate.body.user.adminNotes).toBeUndefined();

    const selfView = await request(app)
      .get(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(selfView.status).toBe(200);
    expect(selfView.body.user.adminNotes).toBeUndefined();

    // An admin can set and see the note; it shows up in both the single-user
    // view and the paginated list.
    const adminNoteUpdate = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ adminNotes: "Called about a late delivery." });
    expect(adminNoteUpdate.status).toBe(200);
    expect(adminNoteUpdate.body.user.adminNotes).toBe("Called about a late delivery.");

    const adminView = await request(app)
      .get(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminView.body.user.adminNotes).toBe("Called about a late delivery.");

    const listAfterNote = await request(app).get("/api/v1/users").set("Authorization", `Bearer ${adminToken}`);
    const listedCustomer = listAfterNote.body.items.find((u: { id: string }) => u.id === customer.id);
    expect(listedCustomer?.adminNotes).toBe("Called about a late delivery.");

    const otherUpdateForbidden = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "Hacked" });
    expect(otherUpdateForbidden.status).toBe(403);

    const deleteForbidden = await request(app)
      .delete(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(deleteForbidden.status).toBe(403);

    const deleteAsAdmin = await request(app)
      .delete(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteAsAdmin.status).toBe(204);
  });

  it("lets an admin create users directly, defaulting role/email/password and rejecting a taken email", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "creator-admin@test.com", role: "ADMIN" });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "creator-customer@test.com" });

    const forbidden = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name: "Walk-in Customer" });
    expect(forbidden.status).toBe(403);

    const invalid = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "" });
    expect(invalid.status).toBe(400);

    // No email/password/role given - defaults to a name-derived email, the
    // shared temporary password, and CUSTOMER.
    const created = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Walk-in Customer" });
    expect(created.status).toBe(201);
    expect(created.body.user.email).toBe("walk.in.customer@nayasofia.com");
    expect(created.body.user.role).toBe("CUSTOMER");

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "walk.in.customer@nayasofia.com", password: "User@12345" });
    expect(login.status).toBe(200);

    // A second user with the same name gets a de-duplicated placeholder email.
    const createdAgain = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Walk-in Customer" });
    expect(createdAgain.status).toBe(201);
    expect(createdAgain.body.user.email).toBe("walk.in.customer2@nayasofia.com");

    // An explicit, already-registered email is rejected rather than silently reused.
    const duplicateEmail = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Someone Else", email: "walk.in.customer@nayasofia.com" });
    expect(duplicateEmail.status).toBe(409);

    // An explicit email/password/role are respected as given.
    const explicit = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "New Admin", email: "new-admin@test.com", password: "CustomPass123!", role: "ADMIN" });
    expect(explicit.status).toBe(201);
    expect(explicit.body.user.email).toBe("new-admin@test.com");
    expect(explicit.body.user.role).toBe("ADMIN");
  });

  it("filters, searches, and sorts the user list", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "search-admin@test.com", role: "ADMIN" });
    await createUserWithToken(prisma, { email: "alice.search@test.com" });
    await createUserWithToken(prisma, { email: "bob.search@test.com" });

    const bySearch = await request(app)
      .get("/api/v1/users?search=alice.search")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.items.every((u: { email: string }) => u.email.includes("alice.search"))).toBe(true);

    const byRole = await request(app)
      .get("/api/v1/users?role=ADMIN")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byRole.status).toBe(200);
    expect(byRole.body.items.every((u: { role: string }) => u.role === "ADMIN")).toBe(true);

    const sortedByEmail = await request(app)
      .get("/api/v1/users?sortBy=email&sortOrder=asc&pageSize=100")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(sortedByEmail.status).toBe(200);
    const emails = sortedByEmail.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual([...emails].sort());
  });

  it("deletes a user with existing orders successfully, detaching (not deleting) their orders", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "delete-admin@test.com", role: "ADMIN" });
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "has-orders@test.com",
    });

    const product = await prisma.product.create({
      data: {
        sku: "DELETE-USER-ORDER",
        name: "Keepsake Ring",
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

    // This used to throw an unhandled foreign-key-constraint error - now
    // Order.userId is onDelete: SetNull, so deletion always succeeds.
    const deleteWithOrders = await request(app)
      .delete(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteWithOrders.status).toBe(204);

    const ordersAfterDelete = await request(app).get("/api/v1/orders?all=true").set("Authorization", `Bearer ${adminToken}`);
    const orphaned = ordersAfterDelete.body.orders.find((o: { id: string }) => o.id === order.body.order.id);
    expect(orphaned).toBeDefined();
    expect(orphaned.userId).toBeNull();
    expect(orphaned.user).toBeNull();
  });

  it("blocks and unblocks a user's ability to place orders, without affecting login or browsing", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "block-admin@test.com", role: "ADMIN" });
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "blockable@test.com",
    });

    const product = await prisma.product.create({
      data: {
        sku: "BLOCK-USER-ORDER",
        name: "Blocked Buyer Ring",
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
    const orderInput = { items: [{ productId: product.id, quantity: 1 }] };

    const block = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isBlocked: true });
    expect(block.status).toBe(200);
    expect(block.body.user.isBlocked).toBe(true);

    const blockedOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderInput);
    expect(blockedOrder.status).toBe(403);
    expect(blockedOrder.body.error).toMatch(/blocked/i);

    // Still fully able to browse and manage their own profile while blocked.
    const browseWhileBlocked = await request(app).get("/api/v1/products");
    expect(browseWhileBlocked.status).toBe(200);
    const profileWhileBlocked = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ address: "456 New Address" });
    expect(profileWhileBlocked.status).toBe(200);

    const unblock = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isBlocked: false });
    expect(unblock.status).toBe(200);
    expect(unblock.body.user.isBlocked).toBe(false);

    const unblockedOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send(orderInput);
    expect(unblockedOrder.status).toBe(201);
  });

  it("lets an admin edit a user's profile fields including email, rejecting a duplicate", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "edit-admin@test.com", role: "ADMIN" });
    const { user: target } = await createUserWithToken(prisma, { email: "edit-target@test.com" });
    await createUserWithToken(prisma, { email: "taken@test.com" });

    const edit = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Edited Name", email: "edited@test.com", phone: "+1-555-0200", address: "789 Admin Ave" });
    expect(edit.status).toBe(200);
    expect(edit.body.user).toMatchObject({
      name: "Edited Name",
      email: "edited@test.com",
      phone: "+1-555-0200",
      address: "789 Admin Ave",
    });

    const duplicateEmail = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "taken@test.com" });
    expect(duplicateEmail.status).toBe(409);
  });

  it("strips isBlocked, email, and isVerified from a non-admin's own profile update", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "self-strip@test.com",
      isVerified: false,
    });

    const selfUpdate = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ isBlocked: true, email: "self-strip-new@test.com", isVerified: true });
    expect(selfUpdate.status).toBe(200);
    expect(selfUpdate.body.user.isBlocked).toBe(false);
    expect(selfUpdate.body.user.email).toBe("self-strip@test.com");
    expect(selfUpdate.body.user.isVerified).toBe(false);
  });

  it("lets an admin manually override a user's OTP-verification status", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "verify-admin@test.com", role: "ADMIN" });
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "unverified@test.com",
      isVerified: false,
    });

    // Genuinely unverified - the domain-invariant order-placement gate applies.
    const product = await prisma.product.create({
      data: {
        sku: "VERIFY-OVERRIDE",
        name: "Verify Override Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 2,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 5,
        isActive: true,
      },
    });
    const blockedOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(blockedOrder.status).toBe(403);

    const markVerified = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isVerified: true });
    expect(markVerified.status).toBe(200);
    expect(markVerified.body.user.isVerified).toBe(true);

    // The manual override actually unblocks ordering, same as completing the real OTP flow would.
    const allowedOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(allowedOrder.status).toBe(201);

    const markUnverified = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isVerified: false });
    expect(markUnverified.status).toBe(200);
    expect(markUnverified.body.user.isVerified).toBe(false);
  });

  it("lets an admin view any user's order history via GET /users/:id/orders", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "history-admin@test.com", role: "ADMIN" });
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "history-customer@test.com",
    });

    const product = await prisma.product.create({
      data: {
        sku: "HISTORY-ORDER",
        name: "History Ring",
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
    await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });

    const historyAsAdmin = await request(app)
      .get(`/api/v1/users/${customer.id}/orders`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(historyAsAdmin.status).toBe(200);
    expect(historyAsAdmin.body.orders).toHaveLength(1);

    const { accessToken: otherToken } = await createUserWithToken(prisma, { email: "history-other@test.com" });
    const historyForbidden = await request(app)
      .get(`/api/v1/users/${customer.id}/orders`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(historyForbidden.status).toBe(403);
  });

  it("summarizes a user's order activity via GET /users/:id/order-summary - earned vs pending vs cancelled, and the most recent order", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "summary-admin@test.com", role: "ADMIN" });
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "summary-customer@test.com",
    });
    const { accessToken: otherToken } = await createUserWithToken(prisma, { email: "summary-other@test.com" });

    // CONFIRMED and DELIVERED both count as "earned"; PENDING counts as
    // "pending"; CANCELLED counts as neither - same classification
    // revenue.service.ts's store-wide report already uses.
    await prisma.order.create({
      data: { userId: customer.id, status: "CONFIRMED", subtotalCents: 10000, totalCents: 10000, createdAt: new Date("2024-01-01") },
    });
    await prisma.order.create({
      data: { userId: customer.id, status: "DELIVERED", subtotalCents: 5000, totalCents: 5000, createdAt: new Date("2024-01-02") },
    });
    await prisma.order.create({
      data: { userId: customer.id, status: "PENDING", subtotalCents: 3000, totalCents: 3000, createdAt: new Date("2024-01-03") },
    });
    const cancelled = await prisma.order.create({
      data: { userId: customer.id, status: "CANCELLED", subtotalCents: 9999, totalCents: 9999, createdAt: new Date("2024-01-04") },
    });

    const forbidden = await request(app)
      .get(`/api/v1/users/${customer.id}/order-summary`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbidden.status).toBe(403);

    const asSelf = await request(app)
      .get(`/api/v1/users/${customer.id}/order-summary`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(asSelf.status).toBe(200);
    expect(asSelf.body.totalSpentCents).toBe(15000);
    expect(asSelf.body.totalPendingCents).toBe(3000);
    // The most recent order overall (by createdAt) - even though it's the
    // CANCELLED one, which counts toward neither total above.
    expect(asSelf.body.lastOrder.id).toBe(cancelled.id);

    const asAdmin = await request(app)
      .get(`/api/v1/users/${customer.id}/order-summary`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.totalSpentCents).toBe(15000);
    expect(asAdmin.body.totalPendingCents).toBe(3000);
  });

  it("sends a payment-reminder notification only when the user actually has a pending order, admin only", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "reminder-admin@test.com", role: "ADMIN" });
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "reminder-customer@test.com",
    });

    const forbidden = await request(app)
      .post(`/api/v1/users/${customer.id}/payment-reminder`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    // No orders at all yet - nothing pending to remind about.
    const noPending = await request(app)
      .post(`/api/v1/users/${customer.id}/payment-reminder`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(noPending.status).toBe(400);

    // A CONFIRMED (earned, not pending) order still shouldn't count.
    await prisma.order.create({
      data: { userId: customer.id, status: "CONFIRMED", subtotalCents: 5000, totalCents: 5000 },
    });
    const stillNoPending = await request(app)
      .post(`/api/v1/users/${customer.id}/payment-reminder`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(stillNoPending.status).toBe(400);

    await prisma.order.create({
      data: { userId: customer.id, status: "PENDING", subtotalCents: 7500, totalCents: 7500 },
    });
    const sent = await request(app)
      .post(`/api/v1/users/${customer.id}/payment-reminder`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(sent.status).toBe(204);

    const notifications = await prisma.notification.findMany({ where: { userId: customer.id, type: "PAYMENT_REMINDER" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toContain("$75.00");

    const missingUser = await request(app)
      .post("/api/v1/users/does-not-exist/payment-reminder")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missingUser.status).toBe(404);
  });

  it("lets the super admin do everything a plain admin can, on admin-gated routes (authorize() role hierarchy)", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: superAdminToken } = await createUserWithToken(prisma, {
      email: "hierarchy-super@test.com",
      role: "SUPER_ADMIN",
    });

    const list = await request(app).get("/api/v1/users").set("Authorization", `Bearer ${superAdminToken}`);
    expect(list.status).toBe(200);

    const created = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ name: "Created By Super Admin" });
    expect(created.status).toBe(201);

    const deleted = await request(app)
      .delete(`/api/v1/users/${created.body.user.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(deleted.status).toBe(204);
  });

  it("only accepts CUSTOMER/ADMIN for role assignment - SUPER_ADMIN is rejected on both create and update", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: superAdminToken } = await createUserWithToken(prisma, {
      email: "assign-super@test.com",
      role: "SUPER_ADMIN",
    });
    const { user: target } = await createUserWithToken(prisma, { email: "assign-target@test.com" });

    const createRejected = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ name: "Nope", role: "SUPER_ADMIN" });
    expect(createRejected.status).toBe(400);

    const updateRejected = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ role: "SUPER_ADMIN" });
    expect(updateRejected.status).toBe(400);

    // Filtering the list by role="SUPER_ADMIN" is fine, though - that's a
    // read, not a grant.
    const filtered = await request(app)
      .get("/api/v1/users?role=SUPER_ADMIN")
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.every((u: { role: string }) => u.role === "SUPER_ADMIN")).toBe(true);
  });

  it("only the super admin can manage another admin account - a plain admin can still manage a customer or themselves", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { user: superAdmin, accessToken: superAdminToken } = await createUserWithToken(prisma, {
      email: "manage-super@test.com",
      role: "SUPER_ADMIN",
    });
    const { user: plainAdmin, accessToken: plainAdminToken } = await createUserWithToken(prisma, {
      email: "manage-admin@test.com",
      role: "ADMIN",
    });
    const { user: otherAdmin } = await createUserWithToken(prisma, {
      email: "manage-other-admin@test.com",
      role: "ADMIN",
    });
    const { user: customer } = await createUserWithToken(prisma, { email: "manage-customer@test.com" });

    // A plain admin viewing/editing/deleting a *different* admin or the
    // super admin: 403, for all three.
    const viewOtherAdmin = await request(app)
      .get(`/api/v1/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${plainAdminToken}`);
    expect(viewOtherAdmin.status).toBe(403);

    const viewSuperAdmin = await request(app)
      .get(`/api/v1/users/${superAdmin.id}`)
      .set("Authorization", `Bearer ${plainAdminToken}`);
    expect(viewSuperAdmin.status).toBe(403);

    const editOtherAdmin = await request(app)
      .patch(`/api/v1/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${plainAdminToken}`)
      .send({ adminNotes: "trying to edit a peer" });
    expect(editOtherAdmin.status).toBe(403);

    const deleteOtherAdmin = await request(app)
      .delete(`/api/v1/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${plainAdminToken}`);
    expect(deleteOtherAdmin.status).toBe(403);

    // The same plain admin can still fully manage a CUSTOMER...
    const editCustomer = await request(app)
      .patch(`/api/v1/users/${customer.id}`)
      .set("Authorization", `Bearer ${plainAdminToken}`)
      .send({ adminNotes: "totally fine" });
    expect(editCustomer.status).toBe(200);

    // ...and their own account.
    const editSelf = await request(app)
      .patch(`/api/v1/users/${plainAdmin.id}`)
      .set("Authorization", `Bearer ${plainAdminToken}`)
      .send({ name: "Updated Self" });
    expect(editSelf.status).toBe(200);
    expect(editSelf.body.user.name).toBe("Updated Self");

    // The super admin, meanwhile, can manage the other admin without restriction.
    const superEditsOtherAdmin = await request(app)
      .patch(`/api/v1/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ adminNotes: "super admin can do this" });
    expect(superEditsOtherAdmin.status).toBe(200);
    expect(superEditsOtherAdmin.body.user.adminNotes).toBe("super admin can do this");

    const superViewsOtherAdmin = await request(app)
      .get(`/api/v1/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(superViewsOtherAdmin.status).toBe(200);

    const superDeletesOtherAdmin = await request(app)
      .delete(`/api/v1/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(superDeletesOtherAdmin.status).toBe(204);
  });
});
