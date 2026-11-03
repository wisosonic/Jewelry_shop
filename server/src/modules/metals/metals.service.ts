import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { AppError } from "../../utils/AppError";
import { repriceAllProducts } from "../products/products.service";
import { getSettings } from "../settings/settings.service";

/**
 * Fetches gold/silver spot prices from the metals.dev API, converts them to
 * per-gram integer cents, and persists them, triggering a full product
 * repricing. The *automatic* scheduler's tick is rate-limited to a shared
 * minimum interval - the admin-editable `Settings.metalPriceRefreshFrequencyMinutes`
 * - so the free-tier API quota isn't burned by ticking every minute (see
 * `metals.scheduler.ts`). The admin's manual "refresh now" button
 * (`metals.controller.ts`) always passes `force: true` and bypasses this
 * floor entirely - a deliberate, explicit admin action isn't something to
 * silently throttle the same way an automatic background check is. This
 * does mean repeated manual clicks each cost a real metals.dev API call,
 * with no throttle of their own - an accepted tradeoff for the button
 * actually doing what it says, not a gap to "fix" by re-adding a limit
 * there.
 */

const TROY_OUNCE_IN_GRAMS = 31.1034768;

/**
 * Expected shape of the metals.dev `/v1/latest` response, confirmed against
 * publicly indexed examples at the time this was written (metals.dev's own
 * docs page returned HTTP 403 to automated fetches). If a live call fails
 * schema validation, check https://metals.dev/docs with a browser and adjust
 * this schema + the field lookups below — the rest of the app only depends
 * on the two numbers returned by {@link fetchSpotPricesPerGramCents}.
 */
const metalsDevResponseSchema = z.object({
  status: z.string(),
  currency: z.string(),
  unit: z.string(),
  metals: z.object({
    gold: z.number(),
    silver: z.number(),
  }),
});

/**
 * Calls the metals.dev latest-prices endpoint and validates the response shape.
 * @throws {AppError} if the API key is missing, the request fails, or the response is unparseable.
 */
async function fetchFromMetalsDev(): Promise<{ gold: number; silver: number; currency: string }> {
  if (!env.metalsApiKey) {
    throw AppError.badRequest("METALS_API_KEY is not configured");
  }

  const url = new URL(`${env.metalsApiBaseUrl}/latest`);
  url.searchParams.set("api_key", env.metalsApiKey);
  url.searchParams.set("currency", env.metalsCurrency);
  url.searchParams.set("unit", "toz");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw AppError.badRequest(`metals.dev request failed with status ${response.status}`);
  }

  const json = await response.json();
  const parsed = metalsDevResponseSchema.parse(json);
  return { gold: parsed.metals.gold, silver: parsed.metals.silver, currency: parsed.currency };
}

/**
 * Converts metals.dev's per-troy-ounce prices into per-gram integer cents,
 * the unit the rest of the app (`Product.currentPriceCents`) works in.
 */
export async function fetchSpotPricesPerGramCents() {
  const { gold, silver, currency } = await fetchFromMetalsDev();
  return {
    currency,
    GOLD: Math.round((gold / TROY_OUNCE_IN_GRAMS) * 100),
    SILVER: Math.round((silver / TROY_OUNCE_IN_GRAMS) * 100),
  };
}

/**
 * Returns the most recently stored gold and silver price records (may be
 * null if never fetched) alongside the current per-metal commission
 * surcharges and USD→LBP display rate. These are included here - not just
 * on the admin-only `/settings` endpoint - because this is the public
 * endpoint `MetalPricesPanel` polls, and they're exactly as public as the
 * product prices they're baked into/displayed alongside. Commission is
 * split by metal type (see the schema comment on
 * `Settings.commissionSellingGoldCentsPerTroyOunce`) - all four fields are
 * returned raw rather than picked for "the" metal, since this endpoint
 * shows gold and silver side by side, not one product's specific rate.
 */
export async function getLatestPrices() {
  const [gold, silver, settings] = await Promise.all([
    prisma.metalPrice.findFirst({ where: { metalType: "GOLD" }, orderBy: { fetchedAt: "desc" } }),
    prisma.metalPrice.findFirst({ where: { metalType: "SILVER" }, orderBy: { fetchedAt: "desc" } }),
    getSettings(),
  ]);
  return {
    gold,
    silver,
    commissionSellingGoldCentsPerTroyOunce: settings.commissionSellingGoldCentsPerTroyOunce,
    commissionSellingSilverCentsPerTroyOunce: settings.commissionSellingSilverCentsPerTroyOunce,
    commissionBuyingGoldCentsPerTroyOunce: settings.commissionBuyingGoldCentsPerTroyOunce,
    commissionBuyingSilverCentsPerTroyOunce: settings.commissionBuyingSilverCentsPerTroyOunce,
    usdToLbpRate: settings.usdToLbpRate,
  };
}

/** Returns the timestamp of the most recent price fetch of any metal, if any. */
async function mostRecentFetchTime(): Promise<Date | null> {
  const latest = await prisma.metalPrice.findFirst({ orderBy: { fetchedAt: "desc" } });
  return latest?.fetchedAt ?? null;
}

/**
 * Fetches and persists fresh gold/silver prices, then reprices every
 * product (immediately reflecting the new spot price in every product's
 * cached `currentPriceCents` - see `repriceAllProducts()`). Shared by both
 * the scheduler's tick (never forced, so the rate limit below actually
 * protects the free-tier quota) and the admin "refresh now" button (always
 * forced - see `metals.controller.ts` - so an explicit admin request is
 * never silently throttled).
 * @param options.force - Bypasses the minimum-refresh-interval guard.
 * @throws {AppError} 429 if called again before `Settings.metalPriceRefreshFrequencyMinutes`
 * has elapsed, unless `options.force` is set.
 */
export async function refreshMetalPrices(options: { force?: boolean } = {}) {
  const [lastFetch, settings] = await Promise.all([mostRecentFetchTime(), getSettings()]);
  if (!options.force && lastFetch) {
    const minutesSince = (Date.now() - lastFetch.getTime()) / 60_000;
    if (minutesSince < settings.metalPriceRefreshFrequencyMinutes) {
      const waitMinutes = Math.ceil(settings.metalPriceRefreshFrequencyMinutes - minutesSince);
      throw AppError.tooManyRequests(
        `Metal prices were refreshed recently. Try again in about ${waitMinutes} minute(s).`
      );
    }
  }

  const prices = await fetchSpotPricesPerGramCents();

  await prisma.$transaction([
    prisma.metalPrice.create({
      data: { metalType: "GOLD", pricePerGramCents: prices.GOLD, currency: prices.currency },
    }),
    prisma.metalPrice.create({
      data: { metalType: "SILVER", pricePerGramCents: prices.SILVER, currency: prices.currency },
    }),
  ]);

  await repriceAllProducts();

  return getLatestPrices();
}
