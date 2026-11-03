import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-orders.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("orders API", () => {
  it("lets a customer place an order and an admin manage it, enforcing stock and RBAC", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    await prisma.settings.create({ data: { id: 1, commissionSellingSilverCentsPerTroyOunce: 3000, commissionBuyingSilverCentsPerTroyOunce: -1500 } });
    const product = await prisma.product.create({
      data: {
        sku: "ORD-TEST-001",
        name: "Order Test Bracelet",
        description: "d",
        category: "BRACELET",
        metalType: "SILVER",
        purity: 0.9,
        weightGrams: 4,
        makingChargeCents: 200,
        currentPriceCents: 560,
        stockQuantity: 2,
        isActive: true,
      },
    });

    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "buyer@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner@test.com", role: "ADMIN" });
    const { accessToken: strangerToken } = await createUserWithToken(prisma, { email: "stranger@test.com" });

    const tooMany = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 5 }] });
    expect(tooMany.status).toBe(400);

    const placed = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }], shippingAddress: "1 Test St" });
    expect(placed.status).toBe(201);
    expect(placed.body.order.status).toBe("PENDING");
    expect(placed.body.order.paymentStatus).toBe("DEFERRED");
    expect(placed.body.order.items[0].unitPriceCentsSnapshot).toBe(560);
    const orderId = placed.body.order.id;

    const ownOrders = await request(app).get("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`);
    expect(ownOrders.status).toBe(200);
    expect(ownOrders.body.items).toHaveLength(1);
    expect(ownOrders.body.total).toBe(1);

    const strangersView = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(strangersView.status).toBe(403);

    // GET /orders/:id must include the owning customer's basic info (not
    // just their id) - AdminOrderInvoice.tsx relies on this to show who
    // placed the order rather than always falling back to "Deleted user".
    const adminView = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminView.status).toBe(200);
    expect(adminView.body.order.user).toMatchObject({ email: "buyer@test.com" });
    expect(adminView.body.order.shippingAddress).toBe("1 Test St");

    const forbiddenStatusChange = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "SHIPPED" });
    expect(forbiddenStatusChange.status).toBe(403);

    // Payment method/currency are also admin-only, and default sensibly
    // (no method set yet, paid in USD) until an admin records otherwise.
    expect(placed.body.order.paymentMethod).toBeNull();
    expect(placed.body.order.paymentCurrency).toBe("USD");

    const invalidPaymentMethod = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED", paymentMethod: "BITCOIN" });
    expect(invalidPaymentMethod.status).toBe(400);

    // Payment method/currency can only be set in the exact same request
    // that confirms the order (moves it to CONFIRMED from something else) -
    // sending them on their own, with no status change, is rejected even
    // though the order is still PENDING.
    const paymentAloneWhilePending = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentMethod: "WHISH_MONEY", paymentCurrency: "LBP" });
    expect(paymentAloneWhilePending.status).toBe(400);
    expect(paymentAloneWhilePending.body.error).toMatch(/confirms the order/i);

    // Setting them together with status: "CONFIRMED" succeeds - this is the
    // one window they can ever be set in.
    const confirmWithPayment = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED", paymentMethod: "WHISH_MONEY", paymentCurrency: "LBP" });
    expect(confirmWithPayment.status).toBe(200);
    expect(confirmWithPayment.body.order.status).toBe("CONFIRMED");
    expect(confirmWithPayment.body.order.paymentMethod).toBe("WHISH_MONEY");
    expect(confirmWithPayment.body.order.paymentCurrency).toBe("LBP");

    // The order is already CONFIRMED - a further attempt to change its
    // payment method/currency is rejected outright, even while nominally
    // re-sending status: "CONFIRMED" (existing.status is no longer
    // something-other-than-CONFIRMED, so this isn't a fresh confirmation).
    const paymentChangeAfterConfirmed = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED", paymentMethod: "CASH_ON_DELIVERY" });
    expect(paymentChangeAfterConfirmed.status).toBe(400);
    expect(paymentChangeAfterConfirmed.body.error).toMatch(/confirms the order/i);
    // The rejected attempt didn't change anything.
    const afterRejectedPaymentChange = await request(app).get(`/api/v1/orders/${orderId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(afterRejectedPaymentChange.body.order.paymentMethod).toBe("WHISH_MONEY");

    const statusChange = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SHIPPED" });
    expect(statusChange.status).toBe(200);
    expect(statusChange.body.order.status).toBe("SHIPPED");
    // A plain status change, with no payment fields in the request, is
    // never blocked by the confirm-window lock - it only ever guards an
    // *attempted* payment method/currency change.
    expect(statusChange.body.order.paymentMethod).toBe("WHISH_MONEY");

    // Re-sending the *same*, already-saved payment method/currency alongside
    // an unrelated status change is fine regardless of the confirm window -
    // nothing is actually changing.
    const noOpPaymentResend = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "DELIVERED", paymentMethod: "WHISH_MONEY", paymentCurrency: "LBP" });
    expect(noOpPaymentResend.status).toBe(200);
    expect(noOpPaymentResend.body.order.status).toBe("DELIVERED");

    const allOrdersAsAdmin = await request(app)
      .get("/api/v1/orders?all=true")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(allOrdersAsAdmin.status).toBe(200);
    expect(allOrdersAsAdmin.body.orders.length).toBeGreaterThanOrEqual(1);

    // A DELIVERED order is past the cancellable stage.
    const cancelTooLate = await request(app)
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(cancelTooLate.status).toBe(400);
  });

  it("blocks an ADMIN-role account from placing an order, even with a directly-crafted request", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-ADMIN-BLOCK-001",
        name: "Admin Block Test Ring",
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
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "order-blocker@test.com", role: "ADMIN" });

    // Admin accounts are always isVerified: true and never isBlocked by
    // default (see users.service.ts's createUser()), so this proves the
    // block is a dedicated role check, not a side effect of either of
    // those other two guards.
    const blocked = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/admin accounts can't place orders/i);

    // Stock must be untouched - the block happens before any order/stock mutation.
    const unchangedProduct = await request(app).get(`/api/v1/products/${product.id}`);
    expect(unchangedProduct.body.product.stockQuantity).toBe(5);
  });

  it("blocks a SUPER_ADMIN account from placing an order too, and still lets it list every order via ?all=true", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-SUPER-ADMIN-BLOCK-001",
        name: "Super Admin Block Test Ring",
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
    const { accessToken: superAdminToken } = await createUserWithToken(prisma, {
      email: "super-order-blocker@test.com",
      role: "SUPER_ADMIN",
    });

    // SUPER_ADMIN has every ADMIN permission (see CLAUDE.md's SUPER_ADMIN
    // bullet), but placing an order isn't one of them - it's a shopping
    // feature, not something either admin tier does.
    const blocked = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/admin accounts can't place orders/i);

    // But it does inherit the admin-only "see every order" branch of GET /orders.
    const listAll = await request(app).get("/api/v1/orders?all=true").set("Authorization", `Bearer ${superAdminToken}`);
    expect(listAll.status).toBe(200);
    expect(Array.isArray(listAll.body.orders)).toBe(true);
  });

  it("snapshots each order item's commission from its own product's metal type, not a shared rate", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "commission-snapshot-boss@test.com", role: "ADMIN" });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "commission-snapshot-buyer@test.com" });

    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        commissionSellingGoldCentsPerTroyOunce: 4000,
        commissionSellingSilverCentsPerTroyOunce: 2500,
      });

    const goldProduct = await prisma.product.create({
      data: {
        sku: "ORD-COMMISSION-GOLD",
        name: "Order Commission Gold Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 1,
        weightGrams: 1,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 5,
        isActive: true,
      },
    });
    const silverProduct = await prisma.product.create({
      data: {
        sku: "ORD-COMMISSION-SILVER",
        name: "Order Commission Silver Ring",
        description: "d",
        category: "RING",
        metalType: "SILVER",
        purity: 1,
        weightGrams: 1,
        makingChargeCents: 0,
        currentPriceCents: 500,
        stockQuantity: 5,
        isActive: true,
      },
    });

    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        items: [
          { productId: goldProduct.id, quantity: 1 },
          { productId: silverProduct.id, quantity: 1 },
        ],
      });
    expect(order.status).toBe(201);

    const goldItem = order.body.order.items.find((i: { productId: string }) => i.productId === goldProduct.id);
    const silverItem = order.body.order.items.find((i: { productId: string }) => i.productId === silverProduct.id);
    expect(goldItem.commissionCentsPerTroyOunceSnapshot).toBe(4000);
    expect(silverItem.commissionCentsPerTroyOunceSnapshot).toBe(2500);
  });

  it("re-sends an order's invoice as a fresh in-app notification (admin only)", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "invoice-admin@test.com", role: "ADMIN" });
    const { user: customer, accessToken: customerToken } = await createUserWithToken(prisma, {
      email: "invoice-customer@test.com",
    });

    const product = await prisma.product.create({
      data: {
        sku: "ORD-INVOICE-RESEND",
        name: "Invoice Resend Ring",
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
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(order.status).toBe(201);
    const orderId = order.body.order.id;

    const forbidden = await request(app)
      .post(`/api/v1/orders/${orderId}/resend-invoice`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    const missing = await request(app)
      .post("/api/v1/orders/does-not-exist/resend-invoice")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);

    const resent = await request(app)
      .post(`/api/v1/orders/${orderId}/resend-invoice`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(resent.status).toBe(204);

    // Reuses ORDER_CONFIRMED (not a new NotificationType) so it stays under
    // the customer's existing ORDER_UPDATES preference - see the
    // in-app-notifications-only domain invariant in CLAUDE.md.
    const notifications = await prisma.notification.findMany({
      where: { userId: customer.id, type: "ORDER_CONFIRMED" },
      orderBy: { createdAt: "asc" },
    });
    expect(notifications).toHaveLength(2); // the original placement notification, plus this resend.
    expect(notifications[1].message).toMatch(/invoice.*resent/i);
    expect(notifications[1].link).toBe(`/orders/${orderId}`);

    // An orphaned order (its account since deleted) has nobody left to notify.
    await prisma.user.delete({ where: { id: customer.id } });
    const orphaned = await request(app)
      .post(`/api/v1/orders/${orderId}/resend-invoice`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(orphaned.status).toBe(409);
  });

  it("lets the owning customer cancel a still-pending order and restores its stock", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-TEST-002",
        name: "Cancellable Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 100,
        currentPriceCents: 900,
        stockQuantity: 5,
        isActive: true,
      },
    });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "canceller@test.com" });
    const { accessToken: strangerToken } = await createUserWithToken(prisma, { email: "stranger2@test.com" });

    const placed = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 2 }] });
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id;

    const afterOrder = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterOrder.stockQuantity).toBe(3); // 5 - 2

    const cancelByStranger = await request(app)
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(cancelByStranger.status).toBe(403);

    const cancelled = await request(app)
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe("CANCELLED");

    const afterCancel = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterCancel.stockQuantity).toBe(5); // restored

    // Cancelling an already-cancelled order is rejected, not a silent no-op.
    const cancelAgain = await request(app)
      .patch(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(cancelAgain.status).toBe(400);
  });

  it("bulk-updates several orders' status at once (admin only)", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-TEST-003",
        name: "Bulk Test Chain",
        description: "d",
        category: "NECKLACE",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 100,
        currentPriceCents: 900,
        stockQuantity: 10,
        isActive: true,
      },
    });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "bulkbuyer@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "bulkadmin@test.com", role: "ADMIN" });

    const orderIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const placed = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ items: [{ productId: product.id, quantity: 1 }] });
      orderIds.push(placed.body.order.id);
    }

    const forbidden = await request(app)
      .patch("/api/v1/orders/bulk-status")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ids: orderIds, status: "CONFIRMED" });
    expect(forbidden.status).toBe(403);

    const bulk = await request(app)
      .patch("/api/v1/orders/bulk-status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ids: orderIds, status: "CONFIRMED" });
    expect(bulk.status).toBe(204);

    for (const id of orderIds) {
      const order = await prisma.order.findUniqueOrThrow({ where: { id } });
      expect(order.status).toBe("CONFIRMED");
    }
  });

  it("permanently deletes a single order (admin only), cascading to its items, and 404s for a missing one", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-DELETE-001",
        name: "Delete Test Ring",
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
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "delete-order-buyer@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "delete-order-admin@test.com", role: "ADMIN" });

    const placed = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id;
    const itemId = placed.body.order.items[0].id;

    const forbidden = await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    const deleted = await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.status).toBe(204);

    expect(await prisma.order.findUnique({ where: { id: orderId } })).toBeNull();
    // OrderItem.order is onDelete: Cascade - its line item must be gone too.
    expect(await prisma.orderItem.findUnique({ where: { id: itemId } })).toBeNull();

    // Deleting is not the same as restoring stock - unlike cancelling, a
    // hard delete leaves stock exactly where it was.
    const productAfter = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(productAfter.stockQuantity).toBe(4);

    const missing = await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });

  it("bulk-deletes several orders at once (admin only), leaving unrelated orders untouched", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-BULK-DELETE",
        name: "Bulk Delete Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 2,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 10,
        isActive: true,
      },
    });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "bulk-delete-buyer@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "bulk-delete-admin@test.com", role: "ADMIN" });

    const toDeleteIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const placed = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ items: [{ productId: product.id, quantity: 1 }] });
      toDeleteIds.push(placed.body.order.id);
    }
    const keep = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] });
    const keepId = keep.body.order.id;

    const forbidden = await request(app)
      .post("/api/v1/orders/bulk-delete")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ids: toDeleteIds });
    expect(forbidden.status).toBe(403);

    const bulkDeleted = await request(app)
      .post("/api/v1/orders/bulk-delete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ids: toDeleteIds });
    expect(bulkDeleted.status).toBe(204);

    for (const id of toDeleteIds) {
      expect(await prisma.order.findUnique({ where: { id } })).toBeNull();
    }
    expect(await prisma.order.findUnique({ where: { id: keepId } })).not.toBeNull();
  });

  it("deletes every order in the system via DELETE /orders/all (admin only), reporting how many were removed", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-DELETE-ALL",
        name: "Delete All Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 2,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 10,
        isActive: true,
      },
    });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "delete-all-buyer@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "delete-all-admin@test.com", role: "ADMIN" });

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ items: [{ productId: product.id, quantity: 1 }] });
    }
    const countBefore = await prisma.order.count();
    expect(countBefore).toBeGreaterThanOrEqual(3);

    const forbidden = await request(app).delete("/api/v1/orders/all").set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    const deleteAll = await request(app).delete("/api/v1/orders/all").set("Authorization", `Bearer ${adminToken}`);
    expect(deleteAll.status).toBe(200);
    expect(deleteAll.body.count).toBe(countBefore);

    expect(await prisma.order.count()).toBe(0);
  });

  it("filters and sorts the admin order list by search, status, date range, and customer (admin only)", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const product = await prisma.product.create({
      data: {
        sku: "ORD-FILTER-001",
        name: "Filter Test Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 2,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 10,
        isActive: true,
      },
    });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "filter-admin@test.com", role: "ADMIN" });
    const { accessToken: aliceToken } = await createUserWithToken(prisma, {
      email: "filter-alice@test.com",
      name: "Filter Customer Alice",
    });
    const { accessToken: bobToken } = await createUserWithToken(prisma, {
      email: "filter-bob@test.com",
      name: "Filter Customer Bob",
    });

    // A distinct, unlikely-to-collide search term scopes every assertion
    // below to just these three orders, regardless of what other tests in
    // this file have left in the (per-file) shared database.
    async function place(token: string) {
      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({ items: [{ productId: product.id, quantity: 1 }] });
      return res.body.order.id as string;
    }
    const aliceOrder1 = await place(aliceToken); // PENDING, earliest
    const bobOrder = await place(bobToken); // will become CONFIRMED, middle date
    const aliceOrder2 = await place(aliceToken); // will become SHIPPED, latest

    await prisma.order.update({ where: { id: aliceOrder1 }, data: { createdAt: new Date("2024-01-01T00:00:00.000Z") } });
    await prisma.order.update({
      where: { id: bobOrder },
      data: { status: "CONFIRMED", createdAt: new Date("2024-02-15T00:00:00.000Z") },
    });
    await prisma.order.update({
      where: { id: aliceOrder2 },
      data: { status: "SHIPPED", createdAt: new Date("2024-03-01T00:00:00.000Z") },
    });

    // A non-admin's ?all=true is silently ignored (falls back to their own
    // paginated history) - filters/sorting only ever apply on the admin branch.
    const nonAdmin = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(nonAdmin.status).toBe(200);
    expect(nonAdmin.body.orders).toBeUndefined();
    expect(nonAdmin.body.items).toBeDefined();

    // search matches the customer's name (and would also match their email
    // or the order's own id, though that's not exercised here).
    const bySearch = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bySearch.status).toBe(200);
    const searchIds = bySearch.body.orders.map((o: { id: string }) => o.id);
    expect(searchIds).toEqual(expect.arrayContaining([aliceOrder1, bobOrder, aliceOrder2]));

    const byNarrowerSearch = await request(app)
      .get("/api/v1/orders?all=true&search=filter-bob@test.com")
      .set("Authorization", `Bearer ${adminToken}`);
    const narrowerIds = byNarrowerSearch.body.orders.map((o: { id: string }) => o.id);
    expect(narrowerIds).toContain(bobOrder);
    expect(narrowerIds).not.toContain(aliceOrder1);
    expect(narrowerIds).not.toContain(aliceOrder2);

    // status filters to an exact match.
    const byStatus = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer&status=CONFIRMED")
      .set("Authorization", `Bearer ${adminToken}`);
    const statusIds = byStatus.body.orders.map((o: { id: string }) => o.id);
    expect(statusIds).toEqual([bobOrder]);

    // status=EARNED is a pseudo-value matching every "earned" status at
    // once (CONFIRMED/SHIPPED/DELIVERED - same bucket revenue.service.ts
    // uses) - AdminRevenue.tsx's "View orders" button on the Earned card
    // links here. Matches Bob's CONFIRMED order and Alice's SHIPPED one,
    // but not her still-PENDING order.
    const byEarned = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer&status=EARNED")
      .set("Authorization", `Bearer ${adminToken}`);
    const earnedIds = byEarned.body.orders.map((o: { id: string }) => o.id);
    expect(earnedIds).toEqual(expect.arrayContaining([bobOrder, aliceOrder2]));
    expect(earnedIds).not.toContain(aliceOrder1);

    // A date range covering only Bob's mid-February order.
    const byDateRange = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer&fromDate=2024-02-01&toDate=2024-02-28")
      .set("Authorization", `Bearer ${adminToken}`);
    const dateRangeIds = byDateRange.body.orders.map((o: { id: string }) => o.id);
    expect(dateRangeIds).toEqual([bobOrder]);

    // toDate is inclusive of that whole day, not just up to its midnight start.
    const toDateInclusive = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer&fromDate=2024-03-01&toDate=2024-03-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(toDateInclusive.body.orders.map((o: { id: string }) => o.id)).toEqual([aliceOrder2]);

    // sortBy=status, ascending: CONFIRMED < PENDING < SHIPPED alphabetically.
    const byStatusSort = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer&sortBy=status&sortOrder=asc")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byStatusSort.body.orders.map((o: { id: string }) => o.id)).toEqual([bobOrder, aliceOrder1, aliceOrder2]);

    // sortBy=customer, ascending: both Alice orders sort before Bob's.
    const byCustomerSort = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer&sortBy=customer&sortOrder=asc")
      .set("Authorization", `Bearer ${adminToken}`);
    const customerSortIds = byCustomerSort.body.orders.map((o: { id: string }) => o.id);
    expect(customerSortIds.indexOf(bobOrder)).toBeGreaterThan(customerSortIds.indexOf(aliceOrder1));
    expect(customerSortIds.indexOf(bobOrder)).toBeGreaterThan(customerSortIds.indexOf(aliceOrder2));

    // Default sort (createdAt desc, no explicit sortBy) - newest first.
    const byDefaultSort = await request(app)
      .get("/api/v1/orders?all=true&search=Filter+Customer")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byDefaultSort.body.orders.map((o: { id: string }) => o.id)).toEqual([aliceOrder2, bobOrder, aliceOrder1]);
  });
});
