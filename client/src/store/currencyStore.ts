import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { cookieStorage } from "../lib/cookieStorage";

export type DisplayCurrency = "USD" | "LBP";

type CurrencyState = {
  /** The shopper's preferred display currency - a pure client-side presentation choice, never sent to the server. */
  currency: DisplayCurrency;
  /**
   * Cached USD->LBP rate from `Settings.usdToLbpRate` (server), refreshed
   * whenever `MetalPricesPanel` loads (`GET /metals/latest` returns it
   * alongside spot prices). Falls back to a placeholder until then.
   */
  usdToLbpRate: number;
  setCurrency: (currency: DisplayCurrency) => void;
  toggleCurrency: () => void;
  setUsdToLbpRate: (rate: number) => void;
};

/**
 * Persisted shopper currency preference - stored in a cookie (not
 * `localStorage`, unlike `cartStore`) so it survives "across sessions" per
 * product requirements. Only `currency` is persisted (see `partialize`
 * below); `usdToLbpRate` is always re-fetched live (see
 * `hooks/useCurrencyRateSync.ts`) rather than cached in the cookie, so a
 * stale rate can never linger across sessions.
 */
export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      currency: "USD",
      usdToLbpRate: 89500,
      setCurrency: (currency) => set({ currency }),
      toggleCurrency: () => set({ currency: get().currency === "USD" ? "LBP" : "USD" }),
      setUsdToLbpRate: (usdToLbpRate) => set({ usdToLbpRate }),
    }),
    {
      name: "naya-sofia-currency",
      storage: createJSONStorage(() => cookieStorage),
      partialize: (state) => ({ currency: state.currency }),
    }
  )
);
