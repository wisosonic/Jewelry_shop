import { describe, expect, it } from "vitest";
import { computePriceCents } from "../src/modules/products/pricing";

describe("computePriceCents", () => {
  it("applies purity, weight, a positive per-troy-ounce commission markup, and making charge for jewelry", () => {
    // commission per gram = 3000 / 31.1034768 = ~96.4522; adjusted metal price = 8000 + 96.4522 = ~8096.4522;
    // *10g*0.75 purity = ~60723.39; +500 making charge = ~61223.39 -> 61223
    const result = computePriceCents({
      pricePerGramCents: 8000,
      weightGrams: 10,
      purity: 0.75,
      commissionCentsPerTroyOunce: 3000,
      makingChargeCents: 500,
      productType: "JEWELRY",
    });
    expect(result).toBe(61223);
  });

  it("applies a negative per-troy-ounce commission (a discount) below the spot metal price", () => {
    // commission per gram = -1500 / 31.1034768 = ~-48.2261; adjusted metal price = 105 - 48.2261 = ~56.7739;
    // *1.2g*0.925 purity = ~63.02; +800 making charge = ~863.02 -> 863
    const result = computePriceCents({
      pricePerGramCents: 105,
      weightGrams: 1.2,
      purity: 0.925,
      commissionCentsPerTroyOunce: -1500,
      makingChargeCents: 800,
      productType: "JEWELRY",
    });
    expect(result).toBe(863);
  });

  it("rounds to the nearest cent", () => {
    // commission per gram = 1550 / 31.1034768 = ~49.8337; adjusted metal price = 105 + 49.8337 = ~154.8337;
    // *1.2g*0.925 purity = ~171.87; +800 making charge = ~971.87 -> 972
    const result = computePriceCents({
      pricePerGramCents: 105,
      weightGrams: 1.2,
      purity: 0.925,
      commissionCentsPerTroyOunce: 1550,
      makingChargeCents: 800,
      productType: "JEWELRY",
    });
    expect(result).toBe(972);
  });

  it("returns just the making charge when the metal price and commission are both zero (jewelry)", () => {
    const result = computePriceCents({
      pricePerGramCents: 0,
      weightGrams: 5,
      purity: 0.5,
      commissionCentsPerTroyOunce: 0,
      makingChargeCents: 1200,
      productType: "JEWELRY",
    });
    expect(result).toBe(1200);
  });

  it("ignores makingChargeCents entirely for BULLION products, even when the field is non-zero", () => {
    // Same inputs as the first test, but productType: "BULLION" - the
    // 500-cent making charge must not appear in the result at all, since
    // bullion is bought for its raw metal content, not crafted.
    // metal value only: ~60723.39 -> 60723 (no +500)
    const result = computePriceCents({
      pricePerGramCents: 8000,
      weightGrams: 10,
      purity: 0.75,
      commissionCentsPerTroyOunce: 3000,
      makingChargeCents: 500,
      productType: "BULLION",
    });
    expect(result).toBe(60723);
  });

  it("prices a BULLION product purely from metal value + commission when makingChargeCents is zero", () => {
    const jewelryEquivalent = computePriceCents({
      pricePerGramCents: 8000,
      weightGrams: 10,
      purity: 0.75,
      commissionCentsPerTroyOunce: 3000,
      makingChargeCents: 0,
      productType: "JEWELRY",
    });
    const bullion = computePriceCents({
      pricePerGramCents: 8000,
      weightGrams: 10,
      purity: 0.75,
      commissionCentsPerTroyOunce: 3000,
      makingChargeCents: 0,
      productType: "BULLION",
    });
    // With no making charge either way, JEWELRY and BULLION must price identically -
    // the only difference between the two product types is whether a making charge applies.
    expect(bullion).toBe(jewelryEquivalent);
  });
});
