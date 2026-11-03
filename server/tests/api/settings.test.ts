import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createUserWithToken } from "../helpers/fixtures";
import { setupTestDatabase, teardownTestDatabase } from "../helpers/testDb";

let dbPath: string;

beforeAll(() => {
  dbPath = setupTestDatabase("test-api-settings.db");
});

afterAll(async () => {
  const { prisma } = await import("../../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("settings API", () => {
  it("restricts settings to admins and reprices existing products when commission changes", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");

    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner@test.com", role: "ADMIN" });
    const { accessToken: customerToken } = await createUserWithToken(prisma, { email: "shopper@test.com" });

    await prisma.metalPrice.create({
      data: { metalType: "GOLD", pricePerGramCents: 10000, currency: "USD", source: "test" },
    });
    const product = await prisma.product.create({
      data: {
        sku: "SET-TEST-001",
        name: "Settings Test Chain",
        description: "d",
        category: "NECKLACE",
        metalType: "GOLD",
        purity: 1,
        weightGrams: 1,
        makingChargeCents: 0,
        currentPriceCents: 0,
        stockQuantity: 1,
        isActive: true,
      },
    });

    const unauthenticated = await request(app).get("/api/v1/settings");
    expect(unauthenticated.status).toBe(401);

    const forbidden = await request(app).get("/api/v1/settings").set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);

    const updated = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionSellingGoldCentsPerTroyOunce: 15552 });
    expect(updated.status).toBe(200);
    expect(updated.body.settings.commissionSellingGoldCentsPerTroyOunce).toBe(15552);

    // Changing commission must immediately reprice existing products, not just future ones.
    // commission per gram = 15552 / 31.1034768 = ~500.0; adjusted metal price = 10000 + 500.0 = ~10500; *1g*purity 1
    const repriced = await request(app).get(`/api/v1/products/${product.id}`);
    expect(repriced.body.product.currentPriceCents).toBe(10500);
  });

  it("reprices gold and silver products independently - a silver-only commission change never touches gold products, and vice versa", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner1b@test.com", role: "ADMIN" });

    await prisma.metalPrice.create({
      data: { metalType: "GOLD", pricePerGramCents: 10000, currency: "USD", source: "test" },
    });
    await prisma.metalPrice.create({
      data: { metalType: "SILVER", pricePerGramCents: 100, currency: "USD", source: "test" },
    });
    const goldProduct = await prisma.product.create({
      data: {
        sku: "SET-TEST-GOLD",
        name: "Settings Test Gold Ring",
        description: "d",
        category: "RING",
        metalType: "GOLD",
        purity: 1,
        weightGrams: 1,
        makingChargeCents: 0,
        currentPriceCents: 0,
        stockQuantity: 1,
        isActive: true,
      },
    });
    const silverProduct = await prisma.product.create({
      data: {
        sku: "SET-TEST-SILVER",
        name: "Settings Test Silver Ring",
        description: "d",
        category: "RING",
        metalType: "SILVER",
        purity: 1,
        weightGrams: 1,
        makingChargeCents: 0,
        currentPriceCents: 0,
        stockQuantity: 1,
        isActive: true,
      },
    });

    // Both products were created directly via Prisma with a hardcoded
    // currentPriceCents: 0 placeholder, not the real computed price - force
    // one real repricing pass first (any settings PATCH reprices
    // everything, even a no-op body) so the "before" snapshots below
    // reflect an actual priced state, not the placeholder.
    await request(app).patch("/api/v1/settings").set("Authorization", `Bearer ${adminToken}`).send({});

    const goldBefore = await request(app).get(`/api/v1/products/${goldProduct.id}`);
    const silverBefore = await request(app).get(`/api/v1/products/${silverProduct.id}`);

    // Changing only the silver selling commission...
    const silverUpdate = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionSellingSilverCentsPerTroyOunce: 31_103 }); // exactly 1000 cents/gram of commission
    expect(silverUpdate.status).toBe(200);

    const goldAfterSilverChange = await request(app).get(`/api/v1/products/${goldProduct.id}`);
    const silverAfterSilverChange = await request(app).get(`/api/v1/products/${silverProduct.id}`);

    // ...leaves the gold product's price untouched...
    expect(goldAfterSilverChange.body.product.currentPriceCents).toBe(goldBefore.body.product.currentPriceCents);
    // ...but does move the silver product's price.
    expect(silverAfterSilverChange.body.product.currentPriceCents).not.toBe(silverBefore.body.product.currentPriceCents);
    // 100 (spot) + 1000 (commission/gram) = 1100 cents/gram * 1g * purity 1 = 1100.
    expect(silverAfterSilverChange.body.product.currentPriceCents).toBe(1100);
  });

  it("rejects a commission value outside the sane +/-$5,000-per-troy-ounce bound, on any of the four gold/silver selling/buying fields", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner2@test.com", role: "ADMIN" });

    const tooHigh = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionSellingGoldCentsPerTroyOunce: 500_001 });
    expect(tooHigh.status).toBe(400);

    const tooLow = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionBuyingSilverCentsPerTroyOunce: -500_001 });
    expect(tooLow.status).toBe(400);

    const atBound = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionSellingGoldCentsPerTroyOunce: 500_000, commissionSellingSilverCentsPerTroyOunce: -500_000 });
    expect(atBound.status).toBe(200);
    expect(atBound.body.settings.commissionSellingGoldCentsPerTroyOunce).toBe(500_000);
    expect(atBound.body.settings.commissionSellingSilverCentsPerTroyOunce).toBe(-500_000);
  });

  it("toggles the OTP-verification master switch", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner3@test.com", role: "ADMIN" });

    const initial = await request(app).get("/api/v1/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(initial.body.settings.otpVerificationEnabled).toBe(true);

    const disabled = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ otpVerificationEnabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.settings.otpVerificationEnabled).toBe(false);

    const reEnabled = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ otpVerificationEnabled: true });
    expect(reEnabled.body.settings.otpVerificationEnabled).toBe(true);
  });

  it("toggles the metal-price schedule master switch", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner4@test.com", role: "ADMIN" });

    const initial = await request(app).get("/api/v1/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(initial.body.settings.metalPriceScheduleEnabled).toBe(true);

    const disabled = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metalPriceScheduleEnabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.settings.metalPriceScheduleEnabled).toBe(false);

    const reEnabled = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metalPriceScheduleEnabled: true });
    expect(reEnabled.body.settings.metalPriceScheduleEnabled).toBe(true);
  });

  it("sets the metal-price refresh frequency, bounded to 1-1440 minutes", async () => {
    const { app } = await import("../../src/app");
    const { prisma } = await import("../../src/db/prisma");
    const { accessToken: adminToken } = await createUserWithToken(prisma, { email: "owner5@test.com", role: "ADMIN" });

    const initial = await request(app).get("/api/v1/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(initial.body.settings.metalPriceRefreshFrequencyMinutes).toBe(60);

    const updated = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metalPriceRefreshFrequencyMinutes: 30 });
    expect(updated.status).toBe(200);
    expect(updated.body.settings.metalPriceRefreshFrequencyMinutes).toBe(30);

    const tooLow = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metalPriceRefreshFrequencyMinutes: 0 });
    expect(tooLow.status).toBe(400);

    const tooHigh = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metalPriceRefreshFrequencyMinutes: 1441 });
    expect(tooHigh.status).toBe(400);

    const atBounds = await request(app)
      .patch("/api/v1/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metalPriceRefreshFrequencyMinutes: 1440 });
    expect(atBounds.status).toBe(200);
    expect(atBounds.body.settings.metalPriceRefreshFrequencyMinutes).toBe(1440);
  });
});
