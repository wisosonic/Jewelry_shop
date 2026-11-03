import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-metals.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("metals API", () => {
  it("exposes latest prices publicly but requires admin auth to refresh", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "shopper@test.com" });
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner@test.com", role: "ADMIN" });

    const publicLatest = await request(app).get("/api/v1/metals/latest");
    expect(publicLatest.status).toBe(200);
    // Commission surcharges ride along on this public endpoint (not just the
    // admin-only /settings one) since MetalPricesPanel needs them and
    // they're no more sensitive than the product prices they're baked into.
    expect(publicLatest.body).toEqual({
      gold: null,
      silver: null,
      commissionSellingGoldCentsPerTroyOunce: 5000,
      commissionSellingSilverCentsPerTroyOunce: 5000,
      commissionBuyingGoldCentsPerTroyOunce: -3000,
      commissionBuyingSilverCentsPerTroyOunce: -3000,
      usdToLbpRate: 89500,
    });

    const forbidden = await request(app).post("/api/v1/metals/refresh").set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    // No METALS_API_KEY is configured in the test environment, so this must
    // fail fast with a clear 400 rather than attempting a real network call.
    const refreshResult = await request(app)
      .post("/api/v1/metals/refresh")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(refreshResult.status).toBe(400);
    expect(refreshResult.body.error).toMatch(/METALS_API_KEY/);
  });

  it("POST /metals/refresh always bypasses the rate-limit floor (force: true) - an admin's explicit click is never throttled", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner2@test.com", role: "ADMIN" });

    // A price fetched 1 second ago - as recent as it gets - under a generous 120-minute floor.
    await prisma.metalPrice.create({
      data: {
        metalType: "GOLD",
        pricePerGramCents: 10000,
        currency: "USD",
        fetchedAt: new Date(Date.now() - 1000),
      },
    });
    await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metalPriceRefreshFrequencyMinutes: 120 });

    // Despite that, the manual endpoint reaches the actual fetch attempt
    // immediately (and fails there instead, since no METALS_API_KEY is
    // configured in tests) rather than being rate-limited - proving it
    // never even checked the floor, not just that this particular call
    // happened to clear it.
    const refreshResult = await request(app)
      .post("/api/v1/metals/refresh")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(refreshResult.status).toBe(400);
    expect(refreshResult.body.error).toMatch(/METALS_API_KEY/);
  });

  it("refreshMetalPrices() without force still respects the admin-editable Settings.metalPriceRefreshFrequencyMinutes floor - the scheduler's own unforced calls stay rate-limited", async () => {
    const { prisma } = await import("../../src/db/prisma");
    const { refreshMetalPrices } = await import("../../src/modules/metals/metals.service");

    // mostRecentFetchTime() looks at the latest fetch across *either* metal
    // with no per-test scoping, so start from a clean slate - otherwise a
    // more-recent row left by an earlier test in this file (e.g. the
    // previous test's forced refresh, fetched moments ago) would still be
    // "the most recent fetch" and make every floor look too-soon here.
    await prisma.metalPrice.deleteMany({});

    // A price fetched 10 minutes ago.
    await prisma.metalPrice.create({
      data: {
        metalType: "SILVER",
        pricePerGramCents: 100,
        currency: "USD",
        fetchedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, metalPriceRefreshFrequencyMinutes: 120 },
      update: { metalPriceRefreshFrequencyMinutes: 120 },
    });

    // 10 minutes ago is well within a 120-minute floor - still rate-limited when not forced.
    await expect(refreshMetalPrices()).rejects.toMatchObject({ statusCode: 429, message: expect.stringMatching(/refreshed recently/) });

    await prisma.settings.update({ where: { id: 1 }, data: { metalPriceRefreshFrequencyMinutes: 5 } });

    // 10 minutes ago is now past a 5-minute floor - the rate limiter lets
    // this through, so it reaches the actual fetch attempt and fails there
    // instead (no METALS_API_KEY configured in tests), proving the gate
    // reacted to the settings change immediately, with no restart.
    await expect(refreshMetalPrices()).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/METALS_API_KEY/) });
  });
});
