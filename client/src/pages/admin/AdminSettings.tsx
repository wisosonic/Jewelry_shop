import { useEffect, useState } from "react";
import { fetchLatestMetalPrices, fetchSettings, refreshMetalPrices, updateSettings } from "../../api/admin";
import { CheckIcon, RefreshIcon } from "../../components/icons/Icon";
import { useToast } from "../../context/ToastContext";
import { formatCentsPerTroyOunce, formatRelativeTime } from "../../lib/format";
import type { MetalPrice, Settings } from "../../types";

// Mirrors settings.schema.ts's METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MIN/MAX
// on the server - duplicated rather than shared, like every other
// client/server constant in this app (no shared package).
const METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MIN = 1;
const METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MAX = 1440;

/** Admin page for viewing/refreshing live metal prices, store settings, and registration OTP controls. Commission has its own dedicated page - see `AdminCommission.tsx`. */
export function AdminSettings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prices, setPrices] = useState<{ gold: MetalPrice | null; silver: MetalPrice | null }>({ gold: null, silver: null });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [usdToLbpRateText, setUsdToLbpRateText] = useState("");
  const [lowStockThresholdText, setLowStockThresholdText] = useState("");
  const [universalOtpCodeText, setUniversalOtpCodeText] = useState("");
  const [otpVerificationEnabled, setOtpVerificationEnabled] = useState(true);
  const [metalPriceScheduleEnabled, setMetalPriceScheduleEnabled] = useState(true);
  const [refreshFrequencyText, setRefreshFrequencyText] = useState("");
  const [refreshFrequencyError, setRefreshFrequencyError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  /** (Re)loads settings and the latest metal prices from the server. */
  function load() {
    setLoadError(false);
    fetchSettings()
      .then((s) => {
        setSettings(s);
        setUsdToLbpRateText(String(s.usdToLbpRate));
        setLowStockThresholdText(String(s.lowStockThreshold));
        setUniversalOtpCodeText(s.universalOtpCode ?? "");
        setOtpVerificationEnabled(s.otpVerificationEnabled);
        setMetalPriceScheduleEnabled(s.metalPriceScheduleEnabled);
        setRefreshFrequencyText(String(s.metalPriceRefreshFrequencyMinutes));
      })
      .catch(() => setLoadError(true));
    fetchLatestMetalPrices()
      .then(setPrices)
      .catch(() => showToast("Couldn't load current metal prices.", "error"));
  }

  useEffect(load, []);

  /** Persists the currency exchange rate and low-stock threshold. */
  async function handleSaveStoreSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    try {
      const usdToLbpRate = Number(usdToLbpRateText);
      const lowStockThreshold = Number(lowStockThresholdText);
      const updated = await updateSettings({
        currency: settings.currency,
        usdToLbpRate: Number.isFinite(usdToLbpRate) && usdToLbpRate > 0 ? usdToLbpRate : settings.usdToLbpRate,
        lowStockThreshold: Number.isFinite(lowStockThreshold) && lowStockThreshold >= 0 ? lowStockThreshold : settings.lowStockThreshold,
      });
      setSettings(updated);
      setUsdToLbpRateText(String(updated.usdToLbpRate));
      setLowStockThresholdText(String(updated.lowStockThreshold));
      showToast("Settings saved.");
    } catch {
      showToast("Couldn't save settings.", "error");
    }
  }

  /**
   * Toggles the registration OTP requirement - saved immediately on click,
   * the same immediate-save pattern `handleToggleMetalPriceSchedule` below
   * uses (and, in turn, `AdminUsers.tsx`'s block/unblock quick action),
   * rather than needing its own "Save" button for a single checkbox. The
   * new value applies to the very next registration - `auth.service.ts`'s
   * `registerUser()` reads `Settings.otpVerificationEnabled` fresh from the
   * database on every call, so there's no cache or running process to
   * restart for this to take effect. Reverts the checkbox if the save
   * fails, so the displayed state never drifts from what the server
   * actually has.
   */
  async function handleToggleOtpVerification(enabled: boolean) {
    setOtpVerificationEnabled(enabled);
    try {
      const updated = await updateSettings({ otpVerificationEnabled: enabled });
      setSettings(updated);
      setOtpVerificationEnabled(updated.otpVerificationEnabled);
      showToast(enabled ? "OTP verification enabled for new registrations." : "OTP verification disabled for new registrations.");
    } catch {
      setOtpVerificationEnabled(!enabled);
      showToast("Couldn't save that change.", "error");
    }
  }

  /** Saves the universal bypass code - its own action, separate from the OTP-requirement toggle above, which saves immediately on its own. */
  async function handleSaveUniversalOtpCode(e: React.FormEvent) {
    e.preventDefault();
    try {
      const updated = await updateSettings({ universalOtpCode: universalOtpCodeText });
      setSettings(updated);
      setUniversalOtpCodeText(updated.universalOtpCode ?? "");
      showToast("Universal bypass code saved.");
    } catch {
      showToast("Couldn't save - the code must be exactly 5 digits (or blank to disable).", "error");
    }
  }

  /**
   * Toggles the automatic metal-price schedule (the recurring cron job and
   * the fetch on server boot) - saved immediately on click, matching
   * AdminUsers.tsx's block/unblock quick action, rather than needing its
   * own "Save" button for a single checkbox. Never affects "Refresh now"
   * above, which always works regardless of this setting. Reverts the
   * checkbox if the save fails, so the displayed state never drifts from
   * what the server actually has.
   */
  async function handleToggleMetalPriceSchedule(enabled: boolean) {
    setMetalPriceScheduleEnabled(enabled);
    try {
      const updated = await updateSettings({ metalPriceScheduleEnabled: enabled });
      setSettings(updated);
      setMetalPriceScheduleEnabled(updated.metalPriceScheduleEnabled);
      showToast(enabled ? "Automatic price refresh enabled." : "Automatic price refresh disabled.");
    } catch {
      setMetalPriceScheduleEnabled(!enabled);
      showToast("Couldn't save that change.", "error");
    }
  }

  /**
   * Persists the refresh frequency - the single number that's both how
   * often the scheduler attempts an automatic refresh AND the minimum gap
   * enforced between any two refreshes (manual or automatic), inside
   * `refreshMetalPrices()` on the server. Its own small Save action next to
   * the input, not folded into "Store settings" below, since it's really
   * part of this "Metal prices" section's own automatic-refresh behavior
   * alongside the schedule toggle above it.
   */
  async function handleSaveRefreshFrequency() {
    if (!settings) return;
    setRefreshFrequencyError(null);

    const minutes = Number(refreshFrequencyText);
    if (
      !Number.isInteger(minutes) ||
      minutes < METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MIN ||
      minutes > METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MAX
    ) {
      setRefreshFrequencyError(
        `Must be a whole number between ${METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MIN} and ${METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MAX}.`
      );
      return;
    }

    try {
      const updated = await updateSettings({ metalPriceRefreshFrequencyMinutes: minutes });
      setSettings(updated);
      setRefreshFrequencyText(String(updated.metalPriceRefreshFrequencyMinutes));
      showToast("Refresh frequency saved.");
    } catch {
      showToast("Couldn't save refresh frequency.", "error");
    }
  }

  /** Forces an out-of-schedule metal price refresh and updates the displayed prices. */
  async function handleRefresh() {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const updated = await refreshMetalPrices();
      setPrices(updated);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const fallbackMessage = message ?? "Could not refresh metal prices.";
      setRefreshError(fallbackMessage);
      showToast(fallbackMessage, "error");
    } finally {
      setIsRefreshing(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load settings.{" "}
        <button onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!settings) return <p className="text-ink-900/60">Loading...</p>;

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Settings</h1>

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg text-ink-900">Metal prices</h2>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <RefreshIcon className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh now"}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-900/50">
          {metalPriceScheduleEnabled
            ? "Automatically refreshed on a schedule (rate-limited to avoid excess API calls); "
            : "Automatic scheduled refresh is off; "}
          "Refresh now" always fetches immediately, bypassing that limit.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-900/70">
          <input
            type="checkbox"
            role="switch"
            aria-checked={metalPriceScheduleEnabled}
            checked={metalPriceScheduleEnabled}
            onChange={(e) => handleToggleMetalPriceSchedule(e.target.checked)}
            className="h-4 w-4 rounded border-brand-300"
          />
          Automatically refresh prices on a schedule
        </label>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block text-sm text-ink-900/70">
            Refresh frequency (minutes)
            <input
              type="text"
              inputMode="numeric"
              placeholder="60"
              value={refreshFrequencyText}
              onChange={(e) => setRefreshFrequencyText(e.target.value.replace(/\D/g, ""))}
              className="mx-2 w-28 rounded-lg border border-brand-300 px-3 py-2"
            />
          </label>
          <button
            onClick={handleSaveRefreshFrequency}
            className="flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
          >
            <CheckIcon className="h-4 w-4" /> Save
          </button>
        </div>
        {refreshFrequencyError && <p className="mt-1 text-sm text-red-600">{refreshFrequencyError}</p>}
        <p className="mt-1 text-xs text-ink-900/50">
          How often automatic refreshes run - also the minimum gap enforced between any two
          refreshes, manual or automatic. Between {METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MIN} and{" "}
          {METAL_PRICE_REFRESH_FREQUENCY_MINUTES_MAX} minutes.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-ink-900/50">Gold (per troy oz)</dt>
            <dd className="text-lg font-semibold text-brand-700">
              {prices.gold ? formatCentsPerTroyOunce(prices.gold.pricePerGramCents, prices.gold.currency) : "-"}
            </dd>
            {prices.gold && (
              <p className="text-xs text-ink-900/50" title={new Date(prices.gold.fetchedAt).toLocaleString()}>
                Updated {formatRelativeTime(prices.gold.fetchedAt)}
              </p>
            )}
          </div>
          <div>
            <dt className="text-ink-900/50">Silver (per troy oz)</dt>
            <dd className="text-lg font-semibold text-brand-700">
              {prices.silver ? formatCentsPerTroyOunce(prices.silver.pricePerGramCents, prices.silver.currency) : "-"}
            </dd>
            {prices.silver && (
              <p className="text-xs text-ink-900/50" title={new Date(prices.silver.fetchedAt).toLocaleString()}>
                Updated {formatRelativeTime(prices.silver.fetchedAt)}
              </p>
            )}
          </div>
        </dl>
        {refreshError && <p className="mt-3 text-sm text-red-600">{refreshError}</p>}
      </section>

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <h2 className="font-serif text-lg text-ink-900">Store settings</h2>
        <form onSubmit={handleSaveStoreSettings} className="mt-4 space-y-4">
          <label className="block text-sm text-ink-900/70">
            Exchange rate (LBP per 1 USD)
            <input
              type="text"
              inputMode="decimal"
              placeholder="89500"
              value={usdToLbpRateText}
              onChange={(e) => setUsdToLbpRateText(e.target.value)}
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
            />
            <span className="mt-1 block text-xs text-ink-900/50">
              Used only to display prices in LBP for shoppers who toggle currency - all prices are still
              stored and charged in USD.
            </span>
          </label>

          <label className="block text-sm text-ink-900/70">
            Low-stock alert threshold
            <input
              type="text"
              inputMode="numeric"
              placeholder="5"
              value={lowStockThresholdText}
              onChange={(e) => setLowStockThresholdText(e.target.value)}
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
            />
            <span className="mt-1 block text-xs text-ink-900/50">
              Products at or below this stock quantity show up in the dashboard's low-stock alert.
            </span>
          </label>

          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700"
          >
            <CheckIcon className="h-4 w-4" /> Save settings
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-xl border border-red-200 bg-red-50/40 p-6">
        <h2 className="font-serif text-lg text-ink-900">OTP verification</h2>
        <p className="mt-1 text-xs text-ink-900/50">
          Controls whether a new registration must verify their phone number with a texted code
          before their account is marked verified.
        </p>
        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-2 text-sm text-ink-900/70">
            <input
              type="checkbox"
              role="switch"
              aria-checked={otpVerificationEnabled}
              checked={otpVerificationEnabled}
              onChange={(e) => handleToggleOtpVerification(e.target.checked)}
              className="h-4 w-4 rounded border-brand-300"
            />
            Require OTP verification for new registrations
          </label>
          <p className="text-xs text-ink-900/50">
            Saved immediately - applies to the very next registration. When off, new
            registrations skip the texted code entirely and are created already verified -
            useful when SMS delivery isn't set up (e.g. local development) or isn't wanted for
            this store. Existing pending accounts are unaffected either way.
          </p>
        </div>

        <hr className="my-4 border-brand-100" />

        <form onSubmit={handleSaveUniversalOtpCode} className="space-y-4">
          <p className="text-xs font-medium">
            Universal bypass code currently:{" "}
            {settings.universalOtpCode ? (
              <span className="text-red-600">enabled ({settings.universalOtpCode})</span>
            ) : (
              <span className="text-green-600">disabled</span>
            )}
          </p>
          <label className="block text-sm text-ink-900/70">
            Universal code
            <input
              type="text"
              inputMode="numeric"
              placeholder="Leave blank to disable"
              value={universalOtpCodeText}
              onChange={(e) => setUniversalOtpCodeText(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2 text-center text-lg tracking-[0.5em]"
            />
            <span className="mt-1 block text-xs text-ink-900/50">
              When set, this exact 5-digit code verifies <strong>any</strong> user's phone number
              during registration, bypassing that account's own generated code entirely. Meant for
              local testing or customer support when SMS delivery isn't practical — leave blank to
              disable, which is the recommended state otherwise, since this weakens phone
              verification for every account at once while it's set.
            </span>
          </label>

          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-full bg-red-600 px-6 py-2 text-white hover:bg-red-700"
          >
            <CheckIcon className="h-4 w-4" /> Save universal code
          </button>
        </form>
      </section>
    </div>
  );
}
