import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Database seed script: idempotently creates default app settings, business
 * contact info/hours, a starting metal price, an admin and a sample
 * customer user, and a catalog of sample products. Run via `prisma db seed`
 * (or the Prisma migrate flow).
 */

const prisma = new PrismaClient();

/** Seeds settings, business info, metal prices, users, and products, upserting so it's safe to re-run. */
async function main() {
  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    // Flat, fixed surcharge per troy ounce on the spot metal price, not a
    // percentage and not per gram: +5000 = a $50.00/oz markup when selling
    // to a customer, -3000 = a $30.00/oz discount off spot when buying
    // metal back. Split by metal type - seeded identically for gold and
    // silver so the seeded product prices below don't need separate math
    // per metal; an admin can differentiate the two afterward.
    create: {
      id: 1,
      commissionSellingGoldCentsPerTroyOunce: 5000,
      commissionSellingSilverCentsPerTroyOunce: 5000,
      commissionBuyingGoldCentsPerTroyOunce: -3000,
      commissionBuyingSilverCentsPerTroyOunce: -3000,
      currency: "USD",
    },
  });
  console.log("Settings ready:", settings);

  const businessInfo = await prisma.businessInfo.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      address: "123 Jewelry Lane, Springfield, USA",
      phone: "+1 (555) 010-0100",
    },
  });
  console.log("Business info ready:", businessInfo);

  const hoursCount = await prisma.businessHours.count();
  if (hoursCount === 0) {
    await prisma.businessHours.createMany({
      data: [
        { dayOfWeek: 0, isOpen: false, openTime: "10:00", closeTime: "19:00" }, // Sunday - closed
        { dayOfWeek: 1, isOpen: true, openTime: "10:00", closeTime: "19:00" },
        { dayOfWeek: 2, isOpen: true, openTime: "10:00", closeTime: "19:00" },
        { dayOfWeek: 3, isOpen: true, openTime: "10:00", closeTime: "19:00" },
        { dayOfWeek: 4, isOpen: true, openTime: "10:00", closeTime: "19:00" },
        { dayOfWeek: 5, isOpen: true, openTime: "10:00", closeTime: "19:00" },
        { dayOfWeek: 6, isOpen: true, openTime: "10:00", closeTime: "19:00" },
      ],
    });
    console.log("Seeded default weekly business hours (Mon-Sat 10am-7pm, closed Sunday)");
  }

  const hasHolidays = await prisma.businessHoliday.findFirst();
  if (!hasHolidays) {
    await prisma.businessHoliday.create({
      data: { date: new Date("2026-12-25"), label: "Christmas Day", isClosed: true },
    });
    console.log("Seeded a sample holiday exception (Christmas Day, closed)");
  }

  // Seed a starting metal price so products have a non-zero price before
  // the scheduler or an admin triggers a real metals.dev fetch.
  const hasPrices = await prisma.metalPrice.findFirst();
  if (!hasPrices) {
    await prisma.metalPrice.createMany({
      data: [
        { metalType: "GOLD", pricePerGramCents: 8500, currency: "USD", source: "seed" },
        { metalType: "SILVER", pricePerGramCents: 105, currency: "USD", source: "seed" },
      ],
    });
    console.log("Seeded placeholder metal prices (replace via admin refresh once METALS_API_KEY is set)");
  }

  // SUPER_ADMIN is a single, non-assignable role (see `utils/roles.ts` and
  // CLAUDE.md's "SUPER_ADMIN" bullet) - the user-management API can never
  // grant it (`ASSIGNABLE_ROLES` excludes it), so this upsert is the one
  // and only place `User.role` is ever set to `"SUPER_ADMIN"`. `update`
  // also sets it (not just `create`) so re-running this script against an
  // existing database that still has this account as a plain `"ADMIN"`
  // (from before this role existed) promotes it, rather than leaving it
  // behind.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@nayasofia.com";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: "Naya Sophia Admin", role: "SUPER_ADMIN" },
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
      name: "Naya Sophia Admin",
      role: "SUPER_ADMIN",
    },
  });
  console.log("Super admin user ready:", admin.email, `(password: ${adminPassword})`);

  const customerPassword = process.env.SEED_USER_PASSWORD ?? "Customer123!";
  const customerEmail = process.env.SEED_USER_EMAIL ?? "customer@nayasofia.com";
  const customer = await prisma.user.upsert({
    where: { email: customerEmail },
    update: {},
    create: {
      email: customerEmail,
      passwordHash: await bcrypt.hash(customerPassword, 12),
      name: "Jane Customer",
      role: "CUSTOMER",
      address: "123 Main St, Springfield",
      phone: "+1-555-0100",
      // Demonstrates the admin-only note field (AdminUsers.tsx) - never
      // shown to the customer themselves, only to an admin viewing/editing
      // this account.
      adminNotes: "VIP customer - prefers gift wrapping on all orders.",
    },
  });
  console.log("Customer user ready:", customer.email, `(password: ${customerPassword})`);

  const goldPrice = 8500; // cents/gram, matches seeded MetalPrice above
  const silverPrice = 105;

  // Mirrors the same constant in pricing.ts/metals.service.ts/lib/format.ts.
  const GRAMS_PER_TROY_OUNCE = 31.1034768;

  /**
   * Computes a seed product's price using the local seed metal prices and
   * settings' commission surcharge - mirrors pricing.ts's computePriceCents()
   * (including its BULLION-skips-making-charge rule), so keep both in sync
   * if the real formula ever changes.
   */
  function priceFor(
    metalType: "GOLD" | "SILVER",
    weightGrams: number,
    purity: number,
    makingChargeCents: number,
    productType?: "JEWELRY" | "BULLION"
  ) {
    const perGram = metalType === "GOLD" ? goldPrice : silverPrice;
    const commissionCentsPerTroyOunce =
      metalType === "GOLD" ? settings.commissionSellingGoldCentsPerTroyOunce : settings.commissionSellingSilverCentsPerTroyOunce;
    const commissionPerGram = commissionCentsPerTroyOunce / GRAMS_PER_TROY_OUNCE;
    const adjustedPerGram = perGram + commissionPerGram;
    const effectiveMakingChargeCents = productType === "BULLION" ? 0 : makingChargeCents;
    return Math.round(adjustedPerGram * weightGrams * purity + effectiveMakingChargeCents);
  }

  const products = [
    {
      sku: "RING-GLD-001",
      name: "Classic 18k Gold Band",
      description: "A timeless 18-karat gold wedding band with a polished finish.",
      category: "RING",
      metalType: "GOLD" as const,
      purity: 0.75,
      weightGrams: 4.2,
      makingChargeCents: 3500,
      stockQuantity: 12,
      imageUrl: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800",
    },
    {
      sku: "RING-SLV-001",
      name: "Sterling Silver Solitaire Ring",
      description: "Sterling silver ring featuring a single round-cut cubic zirconia.",
      category: "RING",
      metalType: "SILVER" as const,
      purity: 0.925,
      weightGrams: 3.1,
      makingChargeCents: 1500,
      stockQuantity: 20,
      imageUrl: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=800",
    },
    {
      sku: "NCK-GLD-001",
      name: "14k Gold Rope Chain Necklace",
      description: "Classic rope-link chain necklace in warm 14-karat gold, 20 inches.",
      category: "NECKLACE",
      metalType: "GOLD" as const,
      purity: 0.585,
      weightGrams: 12.5,
      makingChargeCents: 6000,
      stockQuantity: 8,
      imageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800",
    },
    {
      sku: "NCK-SLV-001",
      name: "Silver Pendant Necklace",
      description: "Fine sterling silver chain with a minimalist teardrop pendant.",
      category: "NECKLACE",
      metalType: "SILVER" as const,
      purity: 0.925,
      weightGrams: 6.0,
      makingChargeCents: 2000,
      stockQuantity: 15,
      imageUrl: "https://images.unsplash.com/photo-1573408301185-9146fe634ad0?w=800",
    },
    {
      sku: "BRC-GLD-001",
      name: "Gold Curb Chain Bracelet",
      description: "18-karat gold curb-link bracelet with a secure lobster clasp.",
      category: "BRACELET",
      metalType: "GOLD" as const,
      purity: 0.75,
      weightGrams: 8.0,
      makingChargeCents: 4500,
      stockQuantity: 10,
      imageUrl: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=800",
    },
    {
      sku: "BRC-SLV-001",
      name: "Sterling Silver Bangle",
      description: "Smooth polished sterling silver bangle bracelet, one size fits most.",
      category: "BRACELET",
      metalType: "SILVER" as const,
      purity: 0.925,
      weightGrams: 9.5,
      makingChargeCents: 1800,
      stockQuantity: 18,
      imageUrl: "https://images.unsplash.com/photo-1676120963306-8969fa6a810e?w=800",
    },
    {
      sku: "ERG-GLD-001",
      name: "14k Gold Hoop Earrings",
      description: "Lightweight 14-karat gold hoop earrings, 25mm diameter.",
      category: "EARRING",
      metalType: "GOLD" as const,
      purity: 0.585,
      weightGrams: 3.0,
      makingChargeCents: 2500,
      stockQuantity: 25,
      imageUrl: "https://images.unsplash.com/photo-1630019852942-f89202989a59?w=800",
    },
    {
      sku: "ERG-SLV-001",
      name: "Silver Stud Earrings",
      description: "Simple sterling silver stud earrings for everyday wear.",
      category: "EARRING",
      metalType: "SILVER" as const,
      purity: 0.925,
      weightGrams: 1.2,
      makingChargeCents: 800,
      stockQuantity: 30,
      imageUrl: "https://images.unsplash.com/photo-1589918155395-9390de934b61?w=800",
    },
  ];

  // Bullion (bars/coins bought for their metal content, not as wearable
  // jewelry) - a separate catalog reachable from its own storefront page.
  const bullionProducts = [
    {
      sku: "BAR-GLD-1G",
      name: "1g Gold Bar",
      description: "999.9 fine gold bar, individually assayed and sealed in tamper-evident packaging.",
      productType: "BULLION" as const,
      category: "BAR",
      metalType: "GOLD" as const,
      purity: 0.9999,
      weightGrams: 1,
      // Bullion has no making charge - it's bought for raw metal content,
      // not crafted (see pricing.ts's computePriceCents()).
      makingChargeCents: 0,
      stockQuantity: 40,
      imageUrl: "https://images.unsplash.com/photo-1610375461369-d613b564f4c4?w=800",
    },
    {
      sku: "BAR-GLD-10G",
      name: "10g Gold Bar",
      description: "999.9 fine gold bar, individually assayed and sealed in tamper-evident packaging.",
      productType: "BULLION" as const,
      category: "BAR",
      metalType: "GOLD" as const,
      purity: 0.9999,
      weightGrams: 10,
      makingChargeCents: 0,
      stockQuantity: 15,
      imageUrl: "https://images.unsplash.com/photo-1718752773168-a44aa1601ddd?w=800",
    },
    {
      sku: "COIN-GLD-1OZ",
      name: "1oz Gold Coin",
      description: "One troy ounce gold bullion coin, .9167 fine, in protective capsule.",
      productType: "BULLION" as const,
      category: "COIN",
      metalType: "GOLD" as const,
      purity: 0.9167,
      weightGrams: 31.1034768,
      makingChargeCents: 0,
      stockQuantity: 25,
      imageUrl: "https://images.unsplash.com/photo-1589180176337-503fed4bcfe0?w=800",
    },
    {
      sku: "BAR-SLV-100G",
      name: "100g Silver Bar",
      description: "999 fine silver bar, individually assayed and sealed in tamper-evident packaging.",
      productType: "BULLION" as const,
      category: "BAR",
      metalType: "SILVER" as const,
      purity: 0.999,
      weightGrams: 100,
      makingChargeCents: 0,
      stockQuantity: 30,
      imageUrl: "https://images.unsplash.com/photo-1641324115253-f66c552336cb?w=800",
    },
    {
      sku: "BAR-SLV-1KG",
      name: "1kg Silver Bar",
      description: "999 fine silver bar, individually assayed and sealed in tamper-evident packaging.",
      productType: "BULLION" as const,
      category: "BAR",
      metalType: "SILVER" as const,
      purity: 0.999,
      weightGrams: 1000,
      makingChargeCents: 0,
      stockQuantity: 10,
      imageUrl: "https://images.unsplash.com/photo-1707783764100-6528510eeaeb?w=800",
    },
    {
      sku: "COIN-SLV-1OZ",
      name: "1oz Silver Coin",
      description: "One troy ounce silver bullion coin, .999 fine, in protective capsule.",
      productType: "BULLION" as const,
      category: "COIN",
      metalType: "SILVER" as const,
      purity: 0.999,
      weightGrams: 31.1034768,
      makingChargeCents: 0,
      stockQuantity: 50,
      imageUrl: "https://images.unsplash.com/photo-1488251550865-19b3b4ae5734?w=800",
    },
  ];

  const allProducts = [...products, ...bullionProducts];

  for (const product of allProducts) {
    const currentPriceCents = priceFor(
      product.metalType,
      product.weightGrams,
      product.purity,
      product.makingChargeCents,
      "productType" in product ? product.productType : undefined
    );
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: { ...product, currentPriceCents, isActive: true },
    });
  }
  console.log(`Seeded ${allProducts.length} products`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
