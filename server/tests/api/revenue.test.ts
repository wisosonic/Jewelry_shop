import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-revenue.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("revenue API", () => {
  it("is admin-only, splits totals into earned vs pending (excluding cancelled), and breaks revenue down by category", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "shopper@test.com" });
    const { user: admin, accessToken: adminToken } = await createUserWithToken(prisma, {
      email: "owner@test.com",
      role: "ADMIN",
    });

    const ring = await prisma.product.create({
      data: {
        sku: "REV-RING",
        name: "Revenue Ring",
        description: "d",
        productType: "JEWELRY",
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
    const bar = await prisma.product.create({
      data: {
        sku: "REV-BAR",
        name: "Revenue Bar",
        description: "d",
        productType: "BULLION",
        category: "BAR",
        metalType: "GOLD",
        purity: 0.999,
        weightGrams: 10,
        makingChargeCents: 0,
        currentPriceCents: 2000,
        stockQuantity: 10,
        isActive: true,
      },
    });

    async function makeOrder(status: string, product: typeof ring, cents: number) {
      await prisma.order.create({
        data: {
          userId: admin.id,
          status,
          subtotalCents: cents,
          totalCents: cents,
          items: {
            create: {
              productId: product.id,
              productNameSnapshot: product.name,
              skuSnapshot: product.sku,
              quantity: 1,
              unitPriceCentsSnapshot: cents,
              metalPricePerGramCentsSnapshot: 100,
              commissionCentsPerTroyOunceSnapshot: 0,
              lineTotalCents: cents,
            },
          },
        },
      });
    }

    await makeOrder("DELIVERED", ring, 1000); // earned, RING
    await makeOrder("PENDING", bar, 2000); // pending, BAR
    await makeOrder("CANCELLED", ring, 500); // excluded entirely

    const forbidden = await request(app)
      .get("/api/v1/revenue/summary")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    const res = await request(app)
      .get("/api/v1/revenue/summary?months=1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalEarnedRevenueCents).toBe(1000);
    expect(res.body.totalPendingRevenueCents).toBe(2000);

    const byCategory = res.body.revenueByCategory as {
      productType: string;
      category: string;
      earnedCents: number;
      pendingCents: number;
    }[];
    const ringEntry = byCategory.find((e) => e.category === "RING" && e.productType === "JEWELRY");
    const barEntry = byCategory.find((e) => e.category === "BAR" && e.productType === "BULLION");
    expect(ringEntry).toMatchObject({ earnedCents: 1000, pendingCents: 0 });
    expect(barEntry).toMatchObject({ earnedCents: 0, pendingCents: 2000 });

    // A single-month window: one trend bucket, matching the totals above.
    expect(res.body.trend).toHaveLength(1);
    expect(res.body.trend[0]).toMatchObject({ earnedCents: 1000, pendingCents: 2000 });
  });

  it("buckets a monthly trend by the order's createdAt, with no gaps for quiet months", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner2@test.com", role: "ADMIN" });

    const product = await prisma.product.create({
      data: {
        sku: "REV-TREND",
        name: "Trend Product",
        description: "d",
        category: "NECKLACE",
        metalType: "SILVER",
        purity: 0.9,
        weightGrams: 5,
        makingChargeCents: 0,
        currentPriceCents: 500,
        stockQuantity: 10,
        isActive: true,
      },
    });

    const before = await request(app)
      .get("/api/v1/revenue/summary?months=3")
      .set("Authorization", `Bearer ${adminToken}`);
    const earnedBefore = new Map<string, number>(
      before.body.trend.map((b: { period: string; earnedCents: number }) => [b.period, b.earnedCents])
    );

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 2, 15);

    await prisma.order.create({
      data: {
        status: "DELIVERED",
        subtotalCents: 700,
        totalCents: 700,
        createdAt: twoMonthsAgo,
        items: {
          create: {
            productId: product.id,
            productNameSnapshot: product.name,
            skuSnapshot: product.sku,
            quantity: 1,
            unitPriceCentsSnapshot: 700,
            metalPricePerGramCentsSnapshot: 100,
            commissionCentsPerTroyOunceSnapshot: 0,
            lineTotalCents: 700,
          },
        },
      },
    });

    const res = await request(app)
      .get("/api/v1/revenue/summary?months=3")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.trend).toHaveLength(3);

    const oldestBucket = res.body.trend[0];
    const expectedPeriod = `${twoMonthsAgo.getUTCFullYear()}-${String(twoMonthsAgo.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(oldestBucket.period).toBe(expectedPeriod);
    // Delta rather than an absolute value - this file's earlier test also
    // contributes revenue to whichever bucket is "now" (shared per-file db).
    expect(oldestBucket.earnedCents - (earnedBefore.get(oldestBucket.period) ?? 0)).toBe(700);

    // Every month in range is present as its own bucket - not missing - even
    // though this order is the only thing this test itself added.
    const periods = (res.body.trend as { period: string }[]).map((b) => b.period);
    expect(new Set(periods).size).toBe(3);
  });

  it("scopes the trend to a fromDate/toDate range, leaving totals/category breakdown unaffected", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner3@test.com", role: "ADMIN" });

    const product = await prisma.product.create({
      data: {
        sku: "REV-DATE-FILTER",
        name: "Date Filter Product",
        description: "d",
        category: "NECKLACE",
        metalType: "SILVER",
        purity: 0.9,
        weightGrams: 5,
        makingChargeCents: 0,
        currentPriceCents: 500,
        stockQuantity: 10,
        isActive: true,
      },
    });

    async function orderAt(createdAt: Date, cents: number) {
      await prisma.order.create({
        data: {
          status: "DELIVERED",
          subtotalCents: cents,
          totalCents: cents,
          createdAt,
          items: {
            create: {
              productId: product.id,
              productNameSnapshot: product.name,
              skuSnapshot: product.sku,
              quantity: 1,
              unitPriceCentsSnapshot: cents,
              metalPricePerGramCentsSnapshot: 100,
              commissionCentsPerTroyOunceSnapshot: 0,
              lineTotalCents: cents,
            },
          },
        },
      });
    }

    // Orders in January and February 2023 - a year safely in the past, so
    // it can never collide with "now"'s trailing-window tests above
    // sharing this same per-file database.
    await orderAt(new Date(Date.UTC(2023, 0, 5)), 1200); // Jan 5 - outside the partial-January range tested below
    await orderAt(new Date(Date.UTC(2023, 0, 22)), 300); // Jan 22 - inside it
    await orderAt(new Date(Date.UTC(2023, 1, 10)), 900); // Feb 10

    // A range fully inside one month - one bucket, only that month's total.
    const wholeJanuary = await request(app)
      .get("/api/v1/revenue/summary?fromDate=2023-01-01&toDate=2023-01-31")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(wholeJanuary.status).toBe(200);
    expect(wholeJanuary.body.filteredRange).toEqual({ fromDate: "2023-01-01", toDate: "2023-01-31" });
    expect(wholeJanuary.body.trend).toHaveLength(1);
    expect(wholeJanuary.body.trend[0]).toMatchObject({ period: "2023-01", earnedCents: 1500 });

    // A range spanning two months - two buckets, oldest first.
    const janAndFeb = await request(app)
      .get("/api/v1/revenue/summary?fromDate=2023-01-01&toDate=2023-02-28")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(janAndFeb.body.trend).toEqual([
      { period: "2023-01", earnedCents: 1500, pendingCents: 0 },
      { period: "2023-02", earnedCents: 900, pendingCents: 0 },
    ]);

    // A range starting mid-month excludes the Jan 5 order (before the
    // range) even though its bucket key ("2023-01") is still pre-seeded -
    // the trend's *bucket* granularity is monthly, but which orders count
    // toward it is exact-day.
    const partialJanuary = await request(app)
      .get("/api/v1/revenue/summary?fromDate=2023-01-20&toDate=2023-01-25")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(partialJanuary.body.trend).toEqual([{ period: "2023-01", earnedCents: 300, pendingCents: 0 }]);

    // A month with no orders still returns a real zero-value bucket, not an empty array.
    const quiet = await request(app)
      .get("/api/v1/revenue/summary?fromDate=2023-03-01&toDate=2023-03-31")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(quiet.body.trend).toEqual([{ period: "2023-03", earnedCents: 0, pendingCents: 0 }]);

    // The totals/category breakdown are all-time regardless of any of the above filters.
    expect(wholeJanuary.body.totalEarnedRevenueCents).toBe(janAndFeb.body.totalEarnedRevenueCents);
    expect(wholeJanuary.body.totalEarnedRevenueCents).toBe(quiet.body.totalEarnedRevenueCents);

    // No fromDate/toDate given at all - the default trailing-window trend, unfiltered.
    const unfiltered = await request(app).get("/api/v1/revenue/summary").set("Authorization", `Bearer ${adminToken}`);
    expect(unfiltered.body.filteredRange).toBeNull();

    // fromDate and toDate must be given together - either alone is rejected.
    const fromOnly = await request(app)
      .get("/api/v1/revenue/summary?fromDate=2023-01-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(fromOnly.status).toBe(400);
    const toOnly = await request(app)
      .get("/api/v1/revenue/summary?toDate=2023-01-31")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(toOnly.status).toBe(400);

    // toDate before fromDate is rejected.
    const backwards = await request(app)
      .get("/api/v1/revenue/summary?fromDate=2023-02-01&toDate=2023-01-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(backwards.status).toBe(400);

    // A range spanning more than MAX_FILTERED_TREND_MONTHS (36) is rejected.
    const tooWide = await request(app)
      .get("/api/v1/revenue/summary?fromDate=2000-01-01&toDate=2023-01-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(tooWide.status).toBe(400);
  });
});
