import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-dashboard.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("dashboard API", () => {
  it("is admin-only and reports aggregate counts", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "shopper@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner@test.com", role: "ADMIN" });
    await prisma.product.create({
      data: {
        sku: "DASH-001",
        name: "Dash Product",
        description: "d",
        category: "RING",
        metalType: "SILVER",
        purity: 0.9,
        weightGrams: 2,
        makingChargeCents: 100,
        currentPriceCents: 300,
        stockQuantity: 5,
        isActive: true,
      },
    });

    const forbidden = await request(app)
      .get("/api/v1/dashboard/summary")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    const summary = await request(app)
      .get("/api/v1/dashboard/summary")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.userCount).toBe(2);
    expect(summary.body.productCount).toBe(1);
    // stockQuantity 5 is at the default lowStockThreshold (5), so it shows up.
    expect(summary.body.lowStockProducts.map((p: { sku: string }) => p.sku)).toContain("DASH-001");
  });

  it("excludes products above the low-stock threshold, and respects a custom threshold", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner2@test.com", role: "ADMIN" });

    await prisma.product.create({
      data: {
        sku: "DASH-PLENTY",
        name: "Well Stocked",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 3,
        makingChargeCents: 100,
        currentPriceCents: 900,
        stockQuantity: 50,
        isActive: true,
      },
    });

    const defaultThreshold = await request(app)
      .get("/api/v1/dashboard/summary")
      .set("Authorization", `Bearer ${adminToken}`);
    const skusAtDefault = defaultThreshold.body.lowStockProducts.map((p: { sku: string }) => p.sku);
    expect(skusAtDefault).not.toContain("DASH-PLENTY");

    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ lowStockThreshold: 60 });

    const withHigherThreshold = await request(app)
      .get("/api/v1/dashboard/summary")
      .set("Authorization", `Bearer ${adminToken}`);
    const skusAtHigherThreshold = withHigherThreshold.body.lowStockProducts.map((p: { sku: string }) => p.sku);
    expect(skusAtHigherThreshold).toContain("DASH-PLENTY");
  });
});
