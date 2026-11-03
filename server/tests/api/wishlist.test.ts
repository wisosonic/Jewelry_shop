import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-wishlist.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("wishlist API", () => {
  it("requires authentication", async () => {
    const { app } = await import("../../src/app");
    const res = await request(app).get("/api/v1/wishlist");
    expect(res.status).toBe(401);
  });

  it("adds, lists, and idempotently re-adds/removes a wishlisted product, scoped to the caller", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: aliceToken } = await createUserWithToken(prisma, { email: "alice@test.com" });
    const { accessToken: bobToken } = await createUserWithToken(prisma, { email: "bob@test.com" });

    const product = await prisma.product.create({
      data: {
        sku: "WISH-001",
        name: "Wishlisted Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 5,
        isActive: true,
      },
    });

    const unknownProduct = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ productId: "does-not-exist" });
    expect(unknownProduct.status).toBe(404);

    const add = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ productId: product.id });
    expect(add.status).toBe(204);

    // Adding the same product again is a no-op, not a conflict/error.
    const addAgain = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ productId: product.id });
    expect(addAgain.status).toBe(204);

    const aliceList = await request(app).get("/api/v1/wishlist").set("Authorization", `Bearer ${aliceToken}`);
    expect(aliceList.status).toBe(200);
    expect(aliceList.body.products).toHaveLength(1);
    expect(aliceList.body.products[0].id).toBe(product.id);

    // Bob's wishlist is separate from Alice's.
    const bobList = await request(app).get("/api/v1/wishlist").set("Authorization", `Bearer ${bobToken}`);
    expect(bobList.body.products).toHaveLength(0);

    const remove = await request(app)
      .delete(`/api/v1/wishlist/${product.id}`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(remove.status).toBe(204);

    const afterRemove = await request(app).get("/api/v1/wishlist").set("Authorization", `Bearer ${aliceToken}`);
    expect(afterRemove.body.products).toHaveLength(0);

    // Removing something not there is also a no-op, not an error.
    const removeAgain = await request(app)
      .delete(`/api/v1/wishlist/${product.id}`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(removeAgain.status).toBe(204);
  });

  it("rejects an admin account trying to add to a wishlist - not a shopping feature for admins", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "wishlist-admin@test.com", role: "ADMIN" });

    const product = await prisma.product.create({
      data: {
        sku: "WISH-ADMIN-001",
        name: "Admin-Blocked Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 5,
        isActive: true,
      },
    });

    const addAsAdmin = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: product.id });
    expect(addAsAdmin.status).toBe(403);

    const adminList = await request(app).get("/api/v1/wishlist").set("Authorization", `Bearer ${adminToken}`);
    expect(adminList.body.products).toHaveLength(0);
  });

  it("rejects a SUPER_ADMIN account the same way - the wishlist restriction isn't specific to the plain ADMIN role", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: superAdminToken } = await createUserWithToken(prisma, {
      email: "wishlist-super-admin@test.com",
      role: "SUPER_ADMIN",
    });
    const product = await prisma.product.create({
      data: {
        sku: "WISH-SUPER-ADMIN-001",
        name: "Super-Admin-Blocked Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 0,
        currentPriceCents: 1000,
        stockQuantity: 5,
        isActive: true,
      },
    });

    const addAsSuperAdmin = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ productId: product.id });
    expect(addAsSuperAdmin.status).toBe(403);
  });
});
