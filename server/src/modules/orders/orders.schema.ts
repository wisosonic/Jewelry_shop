import { z } from "zod";

/** Validation schemas and enums for order endpoints. */

export const ORDER_STATUSES = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"] as const;

// Which statuses count as revenue, and of which kind - the single source of
// truth for "earned" vs "pending" revenue (dashboard.service.ts's
// totalRevenueCents and revenue.service.ts's revenue breakdown both import
// these rather than hardcoding the status lists a second time). CANCELLED is
// deliberately in neither bucket - it's void revenue, not deferred revenue.
export const EARNED_ORDER_STATUSES = ["CONFIRMED", "SHIPPED", "DELIVERED"] as const;
export const PENDING_ORDER_STATUSES = ["PENDING"] as const;

// How the customer actually paid, manually recorded by an admin once payment
// is collected out-of-band (no real payment gateway is wired up yet - see
// payment.service.ts's PaymentProvider adapter, which this is intentionally
// separate from).
export const PAYMENT_METHODS = ["WHISH_MONEY", "CASH_ON_DELIVERY"] as const;

// The currency the customer actually paid in, manually recorded by an admin.
// Distinct from the storefront's display-only LBP conversion (see the "LBP
// is a display-only currency conversion" domain invariant in CLAUDE.md) -
// this stores a currency label only, never a converted amount.
export const PAYMENT_CURRENCIES = ["USD", "LBP"] as const;

/** Request body schema for placing an order. */
export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
  shippingAddress: z.string().optional(),
});

/**
 * Request body schema for an admin editing an order's status, payment
 * method, and/or payment currency together (`AdminOrders.tsx`'s per-row
 * "Save" button sends whichever of these the admin has changed). All
 * optional so a partial update is also valid; an empty body is a harmless
 * no-op.
 */
export const updateOrderAdminFieldsSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  paymentCurrency: z.enum(PAYMENT_CURRENCIES).optional(),
});

/** Request body schema for updating several orders' status at once (admin bulk action). */
export const bulkUpdateOrderStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: z.enum(ORDER_STATUSES),
});

/** Request body schema for permanently deleting several orders at once (admin bulk action) - mirrors products.schema.ts's bulkDeleteSchema. */
export const bulkDeleteOrdersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

/** Validates a route `:id` path param. */
export const idParamSchema = z.object({ id: z.string().min(1) });

export const ORDER_SORT_FIELDS = ["createdAt", "status", "customer"] as const;

// `status` on the admin order list also accepts this pseudo-value, resolved
// in listAllOrders() to `{ in: EARNED_ORDER_STATUSES }` rather than an exact
// match - lets AdminRevenue.tsx's "View orders" button on the Earned card
// link straight to the filtered list without exposing a raw comma-separated
// status list as a query param. There's no "PENDING" equivalent needed since
// that bucket is already exactly one real status (PENDING_ORDER_STATUSES).
export const ORDER_STATUS_FILTER_VALUES = [...ORDER_STATUSES, "EARNED"] as const;

/**
 * Query params accepted by `GET /orders` - `all` selects the admin
 * see-everything branch (`orders.controller.ts`'s `list()`); `page`/`pageSize`
 * paginate the caller's own order history the same way products/users do.
 * `search`/`status`/`fromDate`/`toDate`/`sortBy`/`sortOrder` are honored
 * only on the admin `all=true` branch (`orders.service.ts`'s
 * `listAllOrders()`) - a customer's own paginated history has no need for
 * them, so they're silently unused rather than rejected on that path.
 */
export const listOrdersQuerySchema = z.object({
  all: z.enum(["true"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  // Matches an order's id, or its customer's name/email (case-sensitive
  // `contains`, same convention users.schema.ts's listUsersQuerySchema
  // already uses - SQLite has no `mode: "insensitive"`, unlike Postgres).
  search: z.string().optional(),
  status: z.enum(ORDER_STATUS_FILTER_VALUES).optional(),
  // Plain "YYYY-MM-DD" strings from an `<input type="date">` - coerced to a
  // real Date here so the service never has to parse a raw string itself.
  // `toDate` is treated as inclusive of that whole day (see
  // `listAllOrders()`), not just up to midnight.
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z.enum(ORDER_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
