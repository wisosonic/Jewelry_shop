import { api } from "../lib/api";
import type { Order, OrderStatus, Paginated, PaymentCurrency, PaymentMethod } from "../types";

/** API wrappers for placing and managing orders. */

/**
 * Places an order for the given cart lines. Prices are re-validated and
 * snapshotted server-side from the current product records, so the
 * amounts shown client-side before this call are for display only.
 */
export async function createOrder(input: { items: { productId: string; quantity: number }[]; shippingAddress?: string }) {
  const { data } = await api.post<{ order: Order }>("/orders", input);
  return data.order;
}

/** Fetches a page of the current user's own order history, most recent first. */
export async function fetchMyOrders(params?: { page?: number; pageSize?: number }) {
  const { data } = await api.get<Paginated<Order>>("/orders", { params });
  return data;
}

/** Sorting options for the admin order list - "customer" sorts by the owning user's name. */
export type OrderSortField = "createdAt" | "status" | "customer";

/**
 * A real order status, or the "EARNED" pseudo-status the admin order list's
 * filter also accepts - matches every status revenue.service.ts counts as
 * "earned" (CONFIRMED/SHIPPED/DELIVERED) at once, rather than one exact
 * status. Powers `AdminRevenue.tsx`'s "View orders" link on the Earned
 * card; there's no "PENDING" equivalent needed since that revenue bucket
 * is already exactly one real status.
 */
export type OrderStatusFilter = OrderStatus | "EARNED";

/**
 * Fetches every order across all users (admin only), optionally filtered
 * by a search term (matches the order's id or its customer's name/email),
 * a status (an exact one, or "EARNED" for the CONFIRMED/SHIPPED/DELIVERED
 * bucket), and/or a `[fromDate, toDate]` creation-date range (each a plain
 * "YYYY-MM-DD" string, `toDate` inclusive of that whole day), and sorted by
 * date, status, or customer name.
 */
export async function fetchAllOrders(params?: {
  search?: string;
  status?: OrderStatusFilter;
  fromDate?: string;
  toDate?: string;
  sortBy?: OrderSortField;
  sortOrder?: "asc" | "desc";
}) {
  const { data } = await api.get<{ orders: Order[] }>("/orders", { params: { all: "true", ...params } });
  return data.orders;
}

/** Fetches a single order by id. */
export async function fetchOrder(id: string) {
  const { data } = await api.get<{ order: Order }>(`/orders/${id}`);
  return data.order;
}

/** Updates an order's status, payment method, and/or payment currency (admin only). */
export async function updateOrderAdminFields(
  id: string,
  input: { status?: OrderStatus; paymentMethod?: PaymentMethod | null; paymentCurrency?: PaymentCurrency }
) {
  const { data } = await api.patch<{ order: Order }>(`/orders/${id}`, input);
  return data.order;
}

/** Updates the fulfillment status of several orders at once (admin only). */
export async function bulkUpdateOrderStatus(ids: string[], status: OrderStatus) {
  await api.patch("/orders/bulk-status", { ids, status });
}

/** Cancels one of the caller's own orders, restoring stock, while it's still pending/confirmed. */
export async function cancelOrder(id: string) {
  const { data } = await api.patch<{ order: Order }>(`/orders/${id}/cancel`);
  return data.order;
}

/** Re-sends an order's invoice to its customer as a fresh in-app notification (admin only). */
export async function resendOrderInvoice(id: string) {
  await api.post(`/orders/${id}/resend-invoice`);
}

/** Permanently deletes a single order (admin only) - not the same as cancelling, see CLAUDE.md. */
export async function deleteOrder(id: string) {
  await api.delete(`/orders/${id}`);
}

/** Permanently deletes several orders at once (admin only). */
export async function bulkDeleteOrders(ids: string[]) {
  await api.post("/orders/bulk-delete", { ids });
}

/** Permanently deletes every order in the system (admin only). Resolves with how many were removed. */
export async function deleteAllOrders() {
  const { data } = await api.delete<{ count: number }>("/orders/all");
  return data.count;
}
