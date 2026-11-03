import cron from "node-cron";
import { AppError } from "../../utils/AppError";
import { getSettings } from "../settings/settings.service";
import { refreshMetalPrices } from "./metals.service";

// Deliberately much finer than any admin-configured refresh frequency
// (Settings.metalPriceRefreshFrequencyMinutes, minimum 1 minute) - the tick
// itself is cheap (a settings/MetalPrice read, no external API call unless
// actually due), and ticking every minute means a changed frequency setting
// takes effect on the very next tick rather than after however long the
// previous fixed cron schedule would have made it wait. This replaced a
// static METALS_REFRESH_CRON env var for exactly this reason - a fixed cron
// expression can't be changed at runtime without stopping and recreating
// the scheduled task, which this avoids entirely.
const SCHEDULER_TICK_CRON = "* * * * *";

/**
 * Starts the recurring check that keeps metal spot prices fresh, plus an
 * identical best-effort check on boot so the storefront isn't stuck showing
 * zero prices before the first tick.
 *
 * Both paths funnel through {@link attemptScheduledRefresh}, which first
 * checks `Settings.metalPriceScheduleEnabled` (skipping entirely when off -
 * see that field's schema comment) and then calls `refreshMetalPrices()`,
 * whose own rate-limit guard - driven by the admin-editable
 * `Settings.metalPriceRefreshFrequencyMinutes`, not a fixed schedule -
 * decides whether this particular tick is actually due. A tick that isn't
 * due yet (a 429 `AppError`) is expected and silent - not logged as an
 * error, since most ticks will hit this on purpose; only a genuine failure
 * (network error, bad API key, etc.) is logged.
 *
 * The admin's manual "refresh now" button (`POST /metals/refresh`,
 * `metals.controller.ts`) is a separate call site that always calls
 * `refreshMetalPrices()` directly - never gated by `metalPriceScheduleEnabled`,
 * though still subject to the same rate-limit floor inside
 * `refreshMetalPrices()` itself.
 */
export function startMetalsScheduler() {
  cron.schedule(SCHEDULER_TICK_CRON, () => attemptScheduledRefresh());
  attemptScheduledRefresh();
}

/** One scheduler check: refreshes if due and enabled, silently skips otherwise. */
async function attemptScheduledRefresh(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.metalPriceScheduleEnabled) return;
    await refreshMetalPrices();
    console.log("[metals] scheduled price refresh succeeded");
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 429) return; // not due yet - expected, not an error
    console.error("[metals] scheduled price refresh failed", err);
  }
}
