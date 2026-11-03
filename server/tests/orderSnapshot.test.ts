import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Uses a throwaway SQLite file (never the dev/seed database) so this test
// can freely create/mutate rows without touching real data. process.env is
// set here, before any app module is imported, and every app import below
// is dynamic (`await import(...)`) so it happens *after* this file's
// top-level code runs - static imports of app modules would be hoisted
// above this env setup by the ES module spec and pick up the wrong DB.
const TEST_DB_PATH = path.join(__dirname, "test-order-snapshot.db");
const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

beforeAll(() => {
  for (const suffix of ["", "-journal"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
});

afterAll(async () => {
  const { prisma } = await import("../src/db/prisma");
  await prisma.$disconnect();
  for (const suffix of ["", "-journal"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

describe("order price snapshotting", () => {
  it("keeps historical order line prices fixed after commission and metal price change", async () => {
    const { prisma } = await import("../src/db/prisma");
    const { createOrder } = await import("../src/modules/orders/orders.service");
    const { repriceAllProducts } = await import("../src/modules/products/products.service");

    await prisma.settings.create({
      data: {
        id: 1,
        commissionSellingGoldCentsPerTroyOunce: 3000,
        commissionBuyingGoldCentsPerTroyOunce: -1500,
        currency: "USD",
      },
    });
    await prisma.metalPrice.create({
      data: { metalType: "GOLD", pricePerGramCents: 8000, currency: "USD", source: "test" },
    });

    const user = await prisma.user.create({
      data: { email: "buyer@test.com", passwordHash: "x", name: "Buyer", role: "CUSTOMER" },
    });
    const product = await prisma.product.create({
      data: {
        sku: "TEST-001",
        name: "Test Ring",
        description: "desc",
        category: "RING",
        metalType: "GOLD",
        purity: 0.75,
        weightGrams: 10,
        makingChargeCents: 1000,
        currentPriceCents: 67000,
        stockQuantity: 5,
        isActive: true,
      },
    });

    const order = await createOrder(user.id, { items: [{ productId: product.id, quantity: 1 }] });
    const originalUnitPrice = order.items[0].unitPriceCentsSnapshot;
    const originalCommission = order.items[0].commissionCentsPerTroyOunceSnapshot;
    // createOrder snapshots the product's already-cached currentPriceCents
    // as-is (it doesn't recompute from metal price/commission at order time).
    expect(originalUnitPrice).toBe(67000);

    // Prices change after the order was placed...
    await prisma.settings.update({ where: { id: 1 }, data: { commissionSellingGoldCentsPerTroyOunce: 20000 } });
    await prisma.metalPrice.create({
      data: { metalType: "GOLD", pricePerGramCents: 20000, currency: "USD", source: "test" },
    });
    await repriceAllProducts();

    // ...the live product price moves, but the historical order line does not.
    const reloadedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    const reloadedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

    expect(reloadedOrder.items[0].unitPriceCentsSnapshot).toBe(originalUnitPrice);
    expect(reloadedOrder.items[0].commissionCentsPerTroyOunceSnapshot).toBe(originalCommission);
    expect(reloadedProduct.currentPriceCents).not.toBe(originalUnitPrice);
  });

  it("decrements stock and rejects an order that exceeds available stock", async () => {
    const { prisma } = await import("../src/db/prisma");
    const { createOrder } = await import("../src/modules/orders/orders.service");

    const user = await prisma.user.create({
      data: { email: "buyer2@test.com", passwordHash: "x", name: "Buyer2", role: "CUSTOMER" },
    });
    const product = await prisma.product.create({
      data: {
        sku: "TEST-002",
        name: "Low stock ring",
        description: "d",
        category: "RING",
        metalType: "SILVER",
        purity: 0.925,
        weightGrams: 2,
        makingChargeCents: 100,
        currentPriceCents: 500,
        stockQuantity: 2,
        isActive: true,
      },
    });

    await createOrder(user.id, { items: [{ productId: product.id, quantity: 2 }] });
    const afterFirstOrder = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterFirstOrder.stockQuantity).toBe(0);

    await expect(
      createOrder(user.id, { items: [{ productId: product.id, quantity: 1 }] })
    ).rejects.toThrow();
  });
});
