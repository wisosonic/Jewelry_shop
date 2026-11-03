import { api } from "../lib/api";
import type { DashboardSummary, MetalPrice, Order, Paginated, RevenueSummary, Role, Settings, User, UserOrderSummary } from "../types";

/**
 * API wrappers for the admin panel: user management, store settings,
 * live metal pricing and the dashboard summary. Also used by the
 * customer-facing profile page to update the logged-in user's own details.
 */

/** Fetches a page of registered users (admin only), optionally filtered by a name/email search and/or role, and sorted. */
export async function fetchUsers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: Role;
  sortBy?: "name" | "email" | "createdAt";
  sortOrder?: "asc" | "desc";
}) {
  const { data } = await api.get<Paginated<User>>("/users", { params });
  return data;
}

/**
 * Creates a new user directly (admin only). `email`/`password` are
 * optional - the server derives a placeholder email from `name` and
 * assigns a shared temporary password ("User@12345") when omitted, since
 * there's no email/SMS delivery in this app to send real credentials with;
 * the admin must communicate them to the new user out of band. The
 * returned `user.email` reflects whatever the server actually assigned.
 */
export async function createUser(input: {
  name: string;
  email?: string;
  password?: string;
  role?: Role;
  phone?: string;
  address?: string;
}) {
  const { data } = await api.post<{ user: User }>("/users", input);
  return data.user;
}

/**
 * Fetches a single user by id. Self or admin only, server-side - a
 * customer fetching their own id gets the same shape `GET /me` would;
 * `adminNotes`/`deletionWarningSentAt` are only ever present when the
 * caller is an admin.
 */
export async function fetchUser(id: string) {
  const { data } = await api.get<{ user: User }>(`/users/${id}`);
  return data.user;
}

/**
 * Updates a user's profile fields, role, or password. Also used to save the
 * current user's own profile and to change their own password, in which
 * case `currentPassword` must be supplied (verified server-side) — it's
 * ignored when an admin resets a different user's password. `email`,
 * `isBlocked`, and `isVerified` are admin-only edits - the server silently
 * strips any of them from a non-admin's own update.
 */
export async function updateUser(
  id: string,
  input: Partial<
    Pick<User, "name" | "email" | "phone" | "address" | "role" | "adminNotes" | "isBlocked" | "isVerified">
  > & {
    password?: string;
    currentPassword?: string;
  }
) {
  const { data } = await api.patch<{ user: User }>(`/users/${id}`, input);
  return data.user;
}

/** Deletes a user account (admin only). Always succeeds regardless of order history - the account's own orders are detached, not deleted, and survive as unowned records. */
export async function deleteUser(id: string) {
  await api.delete(`/users/${id}`);
}

/** Fetches a user's order history (self or admin only, server-side) - used by the admin order-history page to show a customer's past orders. */
export async function fetchUserOrderHistory(id: string) {
  const { data } = await api.get<{ orders: Order[] }>(`/users/${id}/orders`);
  return data.orders;
}

/** Fetches a user's order-activity summary (total spent/pending, last order) - used by the admin user-detail page's stat cards. */
export async function fetchUserOrderSummary(id: string) {
  const { data } = await api.get<UserOrderSummary>(`/users/${id}/order-summary`);
  return data;
}

/**
 * Sends a user a one-off in-app reminder about their pending (unpaid)
 * orders (admin only) - `AdminUserDetail.tsx`'s "Send payment reminder"
 * button, shown only when that user's order summary has a non-zero
 * `totalPendingCents`. The server re-derives that same pending total
 * itself and 400s if it's actually zero, so this never sends a misleading
 * reminder even if the client's own check is somehow stale.
 */
export async function sendPaymentReminder(id: string) {
  await api.post(`/users/${id}/payment-reminder`);
}

/** Fetches the store-wide commission/currency settings. */
export async function fetchSettings() {
  const { data } = await api.get<{ settings: Settings }>("/settings");
  return data.settings;
}

/** Updates the per-metal commission surcharges, currency, USD->LBP display rate, and/or low-stock threshold; changing a selling surcharge recalculates that metal's products' prices. */
export async function updateSettings(
  input: Partial<
    Pick<
      Settings,
      | "commissionSellingGoldCentsPerTroyOunce"
      | "commissionSellingSilverCentsPerTroyOunce"
      | "commissionBuyingGoldCentsPerTroyOunce"
      | "commissionBuyingSilverCentsPerTroyOunce"
      | "currency"
      | "usdToLbpRate"
      | "lowStockThreshold"
      | "universalOtpCode"
      | "otpVerificationEnabled"
      | "metalPriceScheduleEnabled"
      | "metalPriceRefreshFrequencyMinutes"
    >
  >
) {
  const { data } = await api.patch<{ settings: Settings }>("/settings", input);
  return data.settings;
}

/** Response shape shared by the latest-prices and refresh endpoints: spot prices plus the current per-metal commission surcharges and display exchange rate. */
export type LatestMetalPrices = {
  gold: MetalPrice | null;
  silver: MetalPrice | null;
  commissionSellingGoldCentsPerTroyOunce: number;
  commissionSellingSilverCentsPerTroyOunce: number;
  commissionBuyingGoldCentsPerTroyOunce: number;
  commissionBuyingSilverCentsPerTroyOunce: number;
  usdToLbpRate: number;
};

/** Fetches the most recently fetched gold/silver spot prices, plus the current per-metal sell/buy commission surcharges. */
export async function fetchLatestMetalPrices() {
  const { data } = await api.get<LatestMetalPrices>("/metals/latest");
  return data;
}

/** Forces an out-of-schedule refresh of metal spot prices (server-side rate-limited). */
export async function refreshMetalPrices() {
  const { data } = await api.post<LatestMetalPrices>("/metals/refresh");
  return data;
}

/** Fetches aggregate stats (revenue, counts, recent orders) for the admin dashboard. */
export async function fetchDashboardSummary() {
  const { data } = await api.get<DashboardSummary>("/dashboard/summary");
  return data;
}

/**
 * Fetches the admin revenue report (earned/pending totals, category
 * breakdown, monthly trend) for the trailing `months` months (default 12,
 * matching the server's default) - or, when `dateFilter` is given, with
 * the trend scoped to that exact `[fromDate, toDate]` range instead
 * (`months` is then ignored server-side; each is a plain "YYYY-MM-DD"
 * string, `toDate` inclusive of that whole day). Only the trend is ever
 * affected by `dateFilter` - the totals and category breakdown stay
 * all-time regardless.
 */
export async function fetchRevenueSummary(
  months?: number,
  dateFilter?: { fromDate: string; toDate: string }
) {
  const { data } = await api.get<RevenueSummary>("/revenue/summary", {
    params: { ...(months ? { months } : undefined), ...dateFilter },
  });
  return data;
}
