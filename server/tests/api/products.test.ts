import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-products.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("products API", () => {
  it("lets anyone browse products but restricts writes to admins", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const emptyList = await request(app).get("/api/v1/products");
    expect(emptyList.status).toBe(200);
    expect(emptyList.body.items).toEqual([]);

    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "shopper@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "boss@test.com", role: "ADMIN" });

    const productInput = {
      sku: "API-TEST-001",
      name: "API Test Ring",
      description: "A ring created via the API test suite.",
      category: "RING",
      metalType: "GOLD",
      purity: 0.75,
      weightGrams: 5,
      makingChargeCents: 1000,
      stockQuantity: 10,
    };

    const unauthorized = await request(app).post("/api/v1/products").send(productInput);
    expect(unauthorized.status).toBe(401);

    const forbidden = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${customerToken}`)
      .send(productInput);
    expect(forbidden.status).toBe(403);

    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(productInput);
    expect(created.status).toBe(201);
    // No metal price is seeded in this test's fresh DB (spot = 0), but the
    // default commission surcharge still applies: 5000 cents/oz / 31.1034768
    // = ~160.75 cents/gram; * 5g * 0.75 purity = ~603.02; + 1000 making charge
    // = ~1603.02 -> 1603.
    expect(created.body.product.currentPriceCents).toBe(1603);
    const productId = created.body.product.id;

    const fetched = await request(app).get(`/api/v1/products/${productId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.product.name).toBe("API Test Ring");

    // The list endpoint attaches each product's aggregate rating (for
    // ProductCard's star display) - a product with no reviews yet reports
    // a null average and a zero count, not an error or a missing field.
    const listed = await request(app).get("/api/v1/products");
    const listedProduct = listed.body.items.find((p: { id: string }) => p.id === productId);
    expect(listedProduct.averageRating).toBeNull();
    expect(listedProduct.reviewCount).toBe(0);

    const updated = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stockQuantity: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body.product.stockQuantity).toBe(3);

    const deleted = await request(app)
      .delete(`/api/v1/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await request(app).get(`/api/v1/products/${productId}`);
    expect(afterDelete.status).toBe(404);
  });

  it("prices a GOLD product with the gold commission and a SILVER product with the silver commission, at create time", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "metal-commission-boss@test.com", role: "ADMIN" });

    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        commissionSellingGoldCentsPerTroyOunce: 31_103, // ~1000 cents/gram
        commissionSellingSilverCentsPerTroyOunce: 3_110, // ~100 cents/gram
      });

    const shared = { purity: 1, weightGrams: 1, makingChargeCents: 0, stockQuantity: 1 };
    const goldProduct = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "METAL-COMMISSION-GOLD", name: "Gold Test", description: "d", category: "RING", metalType: "GOLD", ...shared });
    const silverProduct = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "METAL-COMMISSION-SILVER", name: "Silver Test", description: "d", category: "RING", metalType: "SILVER", ...shared });

    // No metal price is seeded (spot = 0), so the price is purely the
    // metal-specific commission per gram - 1000 for gold, 100 for silver -
    // proving each product picked up its own metal's rate, not a shared one.
    expect(goldProduct.body.product.currentPriceCents).toBe(1000);
    expect(silverProduct.body.product.currentPriceCents).toBe(100);

    // Restore the default commission - this file's Settings row is shared
    // across every test, and later tests (the BULLION one below) assume
    // the untouched 5000-cent default.
    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionSellingGoldCentsPerTroyOunce: 5000, commissionSellingSilverCentsPerTroyOunce: 5000 });
  });

  it("ignores makingChargeCents when pricing a BULLION product, on both create and update", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "bullion-boss@test.com", role: "ADMIN" });

    const bullionInput = {
      sku: "API-TEST-BULLION-001",
      name: "API Test Gold Bar",
      description: "A bullion bar created via the API test suite.",
      productType: "BULLION",
      category: "BAR",
      metalType: "GOLD",
      purity: 0.75,
      weightGrams: 5,
      makingChargeCents: 2000, // deliberately non-zero - must not appear in the price
      stockQuantity: 10,
    };

    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(bullionInput);
    expect(created.status).toBe(201);
    // Same metal value math as the JEWELRY product above (spot = 0, default
    // 5000 cents/oz commission, 5g, 0.75 purity -> ~602.83 -> 603) but with
    // NO making charge added, unlike that test's +1000 -> 1603.
    expect(created.body.product.currentPriceCents).toBe(603);
    const productId = created.body.product.id;

    // Bumping the making charge further on update must still have no effect.
    const updated = await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ makingChargeCents: 50000 });
    expect(updated.status).toBe(200);
    expect(updated.body.product.currentPriceCents).toBe(603);

    // repriceAllProducts() (triggered by a commission change) must also
    // keep ignoring it - not just the create/update code path.
    const repriced = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionSellingGoldCentsPerTroyOunce: 3100 });
    expect(repriced.status).toBe(200);
    // 3100 / 31.1034768 = ~99.6672 cents/gram; * 5g * 0.75 purity = ~373.75 -> 374; no making charge.
    const afterReprice = await request(app).get(`/api/v1/products/${productId}`);
    expect(afterReprice.body.product.currentPriceCents).toBe(374);
  });

  it("rejects invalid product input with a 400", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken } = await createUserWithToken(prisma, { email: "boss2@test.com", role: "ADMIN" });

    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ sku: "", name: "", category: "NOT_A_CATEGORY" });
    expect(res.status).toBe(400);
  });

  it("filters by price range", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    await prisma.product.createMany({
      data: [
        {
          sku: "PRICE-LOW",
          name: "Cheap Ring",
          description: "d",
          category: "RING",
          metalType: "SILVER",
          purity: 0.9,
          weightGrams: 1,
          makingChargeCents: 0,
          currentPriceCents: 500,
          stockQuantity: 1,
          isActive: true,
        },
        {
          sku: "PRICE-HIGH",
          name: "Expensive Ring",
          description: "d",
          category: "RING",
          metalType: "GOLD",
          purity: 0.75,
          weightGrams: 10,
          makingChargeCents: 0,
          currentPriceCents: 50000,
          stockQuantity: 1,
          isActive: true,
        },
      ],
    });

    const filtered = await request(app).get("/api/v1/products?minPriceCents=1000&maxPriceCents=60000");
    expect(filtered.status).toBe(200);
    const skus = filtered.body.items.map((p: { sku: string }) => p.sku);
    expect(skus).toContain("PRICE-HIGH");
    expect(skus).not.toContain("PRICE-LOW");
  });

  it("bulk-activates/deactivates and bulk-deletes products (admin only)", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "bulkshopper@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "bulkboss@test.com", role: "ADMIN" });

    const products = await Promise.all(
      ["BULK-A", "BULK-B"].map((sku) =>
        prisma.product.create({
          data: {
            sku,
            name: sku,
            description: "d",
            category: "RING",
            metalType: "SILVER",
            purity: 0.9,
            weightGrams: 1,
            makingChargeCents: 0,
            currentPriceCents: 500,
            stockQuantity: 1,
            isActive: true,
          },
        })
      )
    );
    const ids = products.map((p) => p.id);

    const forbiddenBulk = await request(app)
      .patch("/api/v1/products/bulk-status")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ ids, isActive: false });
    expect(forbiddenBulk.status).toBe(403);

    const deactivated = await request(app)
      .patch("/api/v1/products/bulk-status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ids, isActive: false });
    expect(deactivated.status).toBe(204);

    for (const id of ids) {
      const product = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(product.isActive).toBe(false);
    }

    const bulkDeleted = await request(app)
      .post("/api/v1/products/bulk-delete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ids });
    expect(bulkDeleted.status).toBe(204);

    const remaining = await prisma.product.count({ where: { id: { in: ids } } });
    expect(remaining).toBe(0);
  });

  it("returns related products in the same category, excluding itself", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const anchor = await prisma.product.create({
      data: {
        sku: "REL-ANCHOR",
        name: "Anchor Necklace",
        description: "d",
        category: "NECKLACE",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 5,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 1,
        isActive: true,
      },
    });
    const sibling = await prisma.product.create({
      data: {
        sku: "REL-SIBLING",
        name: "Sibling Necklace",
        description: "d",
        category: "NECKLACE",
        metalType: "SILVER",
        purity: 0.9,
        weightGrams: 5,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 1,
        isActive: true,
      },
    });

    const related = await request(app).get(`/api/v1/products/${anchor.id}/related`);
    expect(related.status).toBe(200);
    const ids = related.body.products.map((p: { id: string }) => p.id);
    expect(ids).toContain(sibling.id);
    expect(ids).not.toContain(anchor.id);
  });

  it("notifies admins on a low-stock crossing and wishlisting customers on a back-in-stock crossing - never on a change that doesn't cross either threshold", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "stockboss@test.com", role: "ADMIN" });
    const { user: wishlister } = await createUserWithToken(prisma, { email: "waiting-shopper@test.com" });

    await prisma.settings.upsert({ where: { id: 1 }, update: { lowStockThreshold: 5 }, create: { id: 1, lowStockThreshold: 5 } });

    const product = await prisma.product.create({
      data: {
        sku: "STOCK-THRESH",
        name: "Threshold Bangle",
        description: "d",
        category: "BRACELET",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 5,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 10,
        isActive: true,
      },
    });
    await prisma.wishlistItem.create({ data: { userId: wishlister.id, productId: product.id } });

    // A change that doesn't cross the threshold (10 -> 8, still above 5) notifies no one.
    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stockQuantity: 8 });
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: "stockboss@test.com" } });
    expect(await prisma.notification.count({ where: { userId: adminUser.id, type: "LOW_STOCK" } })).toBe(0);

    // Crossing down through the threshold (8 -> 3) notifies every admin, once.
    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stockQuantity: 3 });
    const lowStockNotifications = await prisma.notification.findMany({ where: { userId: adminUser.id, type: "LOW_STOCK" } });
    expect(lowStockNotifications).toHaveLength(1);
    expect(lowStockNotifications[0].message).toContain("Threshold Bangle");

    // Dropping to 0 then back up to a positive value notifies the wishlister.
    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stockQuantity: 0 });
    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stockQuantity: 4 });
    const backInStock = await prisma.notification.findMany({
      where: { userId: wishlister.id, type: "WISHLIST_BACK_IN_STOCK" },
    });
    expect(backInStock).toHaveLength(1);
    expect(backInStock[0].message).toContain("Threshold Bangle");
  });

  it("only honors includeInactive for a recognized admin - never for an anonymous or customer caller", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "peeker@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "inactive-boss@test.com", role: "ADMIN" });

    const hidden = await prisma.product.create({
      data: {
        sku: "HIDDEN-001",
        name: "Discontinued Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 0,
        isActive: false,
      },
    });

    const anonymous = await request(app).get("/api/v1/products?includeInactive=true");
    expect(anonymous.body.items.map((p: { id: string }) => p.id)).not.toContain(hidden.id);

    const customer = await request(app)
      .get("/api/v1/products?includeInactive=true")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(customer.body.items.map((p: { id: string }) => p.id)).not.toContain(hidden.id);

    // An expired/malformed bearer token on this otherwise-public route
    // shouldn't error the request (optionalAuthenticate) - it just isn't
    // honored as an admin either.
    const badToken = await request(app)
      .get("/api/v1/products?includeInactive=true")
      .set("Authorization", "Bearer not-a-real-token");
    expect(badToken.status).toBe(200);
    expect(badToken.body.items.map((p: { id: string }) => p.id)).not.toContain(hidden.id);

    const admin = await request(app)
      .get("/api/v1/products?includeInactive=true")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(admin.body.items.map((p: { id: string }) => p.id)).toContain(hidden.id);
  });
});
