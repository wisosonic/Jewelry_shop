import type { StateStorage } from "zustand/middleware";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

/** Reads a single cookie by name, or `null` if it isn't set. */
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * A zustand `persist` storage adapter backed by a first-party cookie instead
 * of `localStorage` - used for `currencyStore.ts` specifically because the
 * currency preference is meant to persist "across sessions" via a cookie,
 * per product requirements. Only ever holds small, non-sensitive values
 * (a two-letter currency code) - cookies are sent on every request to this
 * origin, so nothing bigger or sensitive belongs in here. `cartStore.ts`
 * intentionally keeps using plain `localStorage` (the default zustand
 * `persist` storage) since it doesn't need cookie semantics.
 */
export const cookieStorage: StateStorage = {
  getItem: (name) => readCookie(name),
  setItem: (name, value) => writeCookie(name, value),
  removeItem: (name) => deleteCookie(name),
};
