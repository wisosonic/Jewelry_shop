import { useEffect, useState } from "react";
import { fetchSettings, updateSettings } from "../../api/admin";
import { CheckIcon } from "../../components/icons/Icon";
import { useToast } from "../../context/ToastContext";
import { formatCents } from "../../lib/format";
import type { Settings } from "../../types";

/** Matches a possibly-incomplete signed decimal as a user types it character by character, e.g. "-", "-5", "-5.", "-5.5". */
const SIGNED_DECIMAL_INPUT = /^-?\d*\.?\d*$/;

// Mirrors settings.schema.ts's COMMISSION_CENTS_PER_TROY_OUNCE_MIN/MAX on the
// server (-$5,000 to $5,000) - duplicated rather than shared, like every
// other client/server constant in this app (no shared package). Purely a
// fat-finger backstop, not a policy limit on where commission is set.
const COMMISSION_DOLLARS_PER_TROY_OUNCE_MIN = -5000;
const COMMISSION_DOLLARS_PER_TROY_OUNCE_MAX = 5000;

/** Parses a commission input's dollar text into cents for live preview, falling back to the last committed value while the text is incomplete (e.g. "-", "-5."). */
function previewCommissionCents(text: string, fallbackCents: number): number {
  const dollars = Number(text);
  return text.trim() !== "" && Number.isFinite(dollars) ? Math.round(dollars * 100) : fallbackCents;
}

type MetalKey = "Gold" | "Silver";

/**
 * Dedicated admin page for the store's commission surcharges (still backed
 * by the same `Settings` row as the general Settings page - this is a UI
 * split, not a separate data model). Split out of `AdminSettings.tsx` into
 * its own page/route since commission is the setting most likely to grow
 * more controls over time (e.g. a per-category rate) and deserves its own
 * space to grow into, rather than sharing a page with unrelated store
 * configuration.
 *
 * Commission is set separately per metal type (gold vs. silver) - see the
 * schema comment on `Settings.commissionSellingGoldCentsPerTroyOunce` on
 * the server for why. Both metals' selling/buying rates are edited and
 * saved together in one form, since an admin reviewing commission is
 * likely reviewing both at once.
 */
export function AdminCommission() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);

  // The commission inputs are backed by their own raw text, not derived
  // directly from `settings` on every render. A plain `<input type="number">`
  // (or a derived `value={cents / 100}`) resets to "0" the instant you type a
  // lone "-" or "-5.", because the DOM reports an incomplete number as ""
  // and `Number("")` is 0 - that 0 round-trips back into the controlled
  // `value` before you can finish typing a negative number. Keeping the
  // field's own text as the source of truth while typing avoids that.
  const [sellGoldText, setSellGoldText] = useState("");
  const [buyGoldText, setBuyGoldText] = useState("");
  const [sellSilverText, setSellSilverText] = useState("");
  const [buySilverText, setBuySilverText] = useState("");
  const [commissionError, setCommissionError] = useState<string | null>(null);

  /** (Re)loads settings from the server. */
  function load() {
    setLoadError(false);
    fetchSettings()
      .then((s) => {
        setSettings(s);
        setSellGoldText(String(s.commissionSellingGoldCentsPerTroyOunce / 100));
        setBuyGoldText(String(s.commissionBuyingGoldCentsPerTroyOunce / 100));
        setSellSilverText(String(s.commissionSellingSilverCentsPerTroyOunce / 100));
        setBuySilverText(String(s.commissionBuyingSilverCentsPerTroyOunce / 100));
      })
      .catch(() => setLoadError(true));
  }

  useEffect(load, []);

  /** Updates a commission text field, accepting only characters that could be part of a signed decimal. */
  function handleCommissionTextChange(setText: (text: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      if (SIGNED_DECIMAL_INPUT.test(text)) setText(text);
    };
  }

  /** Persists all four edited commission surcharges (gold/silver x selling/buying) together. */
  async function handleSaveCommission(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setCommissionError(null);

    const sellingGoldCents = previewCommissionCents(sellGoldText, settings.commissionSellingGoldCentsPerTroyOunce);
    const buyingGoldCents = previewCommissionCents(buyGoldText, settings.commissionBuyingGoldCentsPerTroyOunce);
    const sellingSilverCents = previewCommissionCents(sellSilverText, settings.commissionSellingSilverCentsPerTroyOunce);
    const buyingSilverCents = previewCommissionCents(buySilverText, settings.commissionBuyingSilverCentsPerTroyOunce);
    const outOfRange = (cents: number) =>
      cents / 100 < COMMISSION_DOLLARS_PER_TROY_OUNCE_MIN || cents / 100 > COMMISSION_DOLLARS_PER_TROY_OUNCE_MAX;
    if ([sellingGoldCents, buyingGoldCents, sellingSilverCents, buyingSilverCents].some(outOfRange)) {
      setCommissionError(
        `Commission must be between $${COMMISSION_DOLLARS_PER_TROY_OUNCE_MIN.toLocaleString()} and $${COMMISSION_DOLLARS_PER_TROY_OUNCE_MAX.toLocaleString()} per troy ounce.`
      );
      return;
    }

    try {
      const updated = await updateSettings({
        commissionSellingGoldCentsPerTroyOunce: sellingGoldCents,
        commissionBuyingGoldCentsPerTroyOunce: buyingGoldCents,
        commissionSellingSilverCentsPerTroyOunce: sellingSilverCents,
        commissionBuyingSilverCentsPerTroyOunce: buyingSilverCents,
      });
      setSettings(updated);
      setSellGoldText(String(updated.commissionSellingGoldCentsPerTroyOunce / 100));
      setBuyGoldText(String(updated.commissionBuyingGoldCentsPerTroyOunce / 100));
      setSellSilverText(String(updated.commissionSellingSilverCentsPerTroyOunce / 100));
      setBuySilverText(String(updated.commissionBuyingSilverCentsPerTroyOunce / 100));
      showToast("Commission saved.");
    } catch {
      showToast("Couldn't save commission.", "error");
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load commission settings.{" "}
        <button onClick={load} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!settings) return <p className="text-ink-900/60">Loading...</p>;

  /** Renders one metal's Selling + Buying commission inputs. */
  function metalFields(
    metal: MetalKey,
    sellText: string,
    setSellText: (text: string) => void,
    sellFallbackCents: number,
    buyText: string,
    setBuyText: (text: string) => void,
    buyFallbackCents: number
  ) {
    return (
      <div>
        <h3 className="font-serif text-base text-ink-900">{metal}</h3>
        <div className="mt-3 space-y-4">
          <label className="block text-sm text-ink-900/70">
            {metal} selling commission ($ per troy oz) —{" "}
            <span className="font-medium text-green-600">
              {formatCents(previewCommissionCents(sellText, sellFallbackCents), settings!.currency, 0)}/oz
            </span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={sellText}
              onChange={handleCommissionTextChange(setSellText)}
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-ink-900/70">
            {metal} buying commission ($ per troy oz) —{" "}
            <span className="font-medium text-red-600">
              {formatCents(previewCommissionCents(buyText, buyFallbackCents), settings!.currency, 0)}/oz
            </span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={buyText}
              onChange={handleCommissionTextChange(setBuyText)}
              className="mt-1 w-full rounded-lg border border-brand-300 px-3 py-2"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Commission</h1>
      <p className="mt-1 text-sm text-ink-900/60">
        A flat, fixed amount per troy ounce added to (or, if negative, subtracted from) the spot
        metal price - not a percentage. Use a positive number for a markup, a negative number for
        a discount. Set separately for gold and silver, since the two are typically traded at very
        different commission levels. Each must be between $
        {COMMISSION_DOLLARS_PER_TROY_OUNCE_MIN.toLocaleString()} and $
        {COMMISSION_DOLLARS_PER_TROY_OUNCE_MAX.toLocaleString()} per troy ounce.
      </p>

      <section className="mt-6 rounded-xl border border-brand-200 bg-white p-6">
        <form onSubmit={handleSaveCommission} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {metalFields(
              "Gold",
              sellGoldText,
              setSellGoldText,
              settings.commissionSellingGoldCentsPerTroyOunce,
              buyGoldText,
              setBuyGoldText,
              settings.commissionBuyingGoldCentsPerTroyOunce
            )}
            {metalFields(
              "Silver",
              sellSilverText,
              setSellSilverText,
              settings.commissionSellingSilverCentsPerTroyOunce,
              buySilverText,
              setBuySilverText,
              settings.commissionBuyingSilverCentsPerTroyOunce
            )}
          </div>
          {commissionError && <p className="text-sm text-red-600">{commissionError}</p>}
          <p className="text-xs text-ink-900/50">
            Changing a selling commission immediately recalculates that metal's products' prices.
          </p>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-full bg-brand-600 px-6 py-2 text-white hover:bg-brand-700"
          >
            <CheckIcon className="h-4 w-4" /> Save commission
          </button>
        </form>
      </section>
    </div>
  );
}
