import { prisma } from "../../db/prisma";
import { AppError } from "../../utils/AppError";
import { createNotification, notifyAdminsOfEvent } from "../notifications/inAppNotifications.service";
import { paymentProvider } from "../payments/payment.service";
import { checkStockThresholds } from "../products/products.service";
import { sellingCommissionForMetal } from "../settings/settings.service";
import { isAdminRole } from "../../utils/roles";
import { z } from "zod";
import { createOrderSchema, EARNED_ORDER_STATUSES, ORDER_SORT_FIELDS } from "./orders.schema";

/** Business logic for placing orders and managing their lifecycle. */

/**
 * Places an order: validates stock/availability, snapshots pricing at
 * purchase time, decrements stock, creates a payment intent, and sends a
 * confirmation notification — all within a single database transaction for
 * the order/items/stock changes.
 * @throws {AppError} 403 if the caller is an ADMIN-role account (shopping
 * is not part of how an admin uses this app - see the identical
 * restriction on `wishlist.service.ts`'s `addToWishlist()`, which this
 * mirrors for the same reason: a real API endpoint exists here, so hiding
 * the cart/checkout UI alone can't actually stop a direct call to it), if
 * the account hasn't completed OTP phone verification yet (see the
 * `User.isVerified` domain invariant - an unverified account can browse
 * and log in, but not purchase), or if an admin has blocked the account
 * (see `User.isBlocked` - same restriction, different reason). 400 if any
 * product is inactive/missing or lacks sufficient stock.
 */
export async function createOrder(userId: string, input: z.infer<typeof createOrderSchema>) {
  const settings =
    (await prisma.settings.findUnique({ where: { id: 1 } })) ??
    (await prisma.settings.create({ data: { id: 1 } }));

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (isAdminRole(user.role)) {
    throw AppError.forbidden("Admin accounts can't place orders.");
  }
  if (!user.isVerified) {
    throw AppError.forbidden("Verify your phone number before placing an order.");
  }
  if (user.isBlocked) {
    throw AppError.forbidden("Your account has been blocked from placing orders. Contact support for help.");
  }

  const stockChanges: { productId: string; productName: string; previousStock: number; newStock: number }[] = [];

  const order = await prisma.$transaction(async (tx) => {
    let subtotalCents = 0;
    const itemsData = [];

    for (const line of input.items) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product || !product.isActive) {
        throw AppError.badRequest(`Product ${line.productId} is not available`);
      }
      if (product.stockQuantity < line.quantity) {
        throw AppError.badRequest(`Insufficient stock for ${product.name}`);
      }

      const latestMetalPrice = await tx.metalPrice.findFirst({
        where: { metalType: product.metalType },
        orderBy: { fetchedAt: "desc" },
      });

      const lineTotalCents = product.currentPriceCents * line.quantity;
      subtotalCents += lineTotalCents;

      itemsData.push({
        productId: product.id,
        productNameSnapshot: product.name,
        skuSnapshot: product.sku,
        quantity: line.quantity,
        unitPriceCentsSnapshot: product.currentPriceCents,
        metalPricePerGramCentsSnapshot: latestMetalPrice?.pricePerGramCents ?? 0,
        commissionCentsPerTroyOunceSnapshot: sellingCommissionForMetal(settings, product.metalType),
        lineTotalCents,
      });

      await tx.product.update({
        where: { id: product.id },
        data: { stockQuantity: { decrement: line.quantity } },
      });
      stockChanges.push({
        productId: product.id,
        productName: product.name,
        previousStock: product.stockQuantity,
        newStock: product.stockQuantity - line.quantity,
      });
    }

    return tx.order.create({
      data: {
        userId,
        status: "PENDING",
        subtotalCents,
        totalCents: subtotalCents,
        currency: settings.currency,
        shippingAddress: input.shippingAddress,
        items: { create: itemsData },
      },
      include: { items: true },
    });
  });

  const paymentIntent = await paymentProvider.createIntent({
    orderId: order.id,
    amountCents: order.totalCents,
    currency: order.currency,
  });
  const orderWithPayment = await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentProvider: paymentIntent.provider,
      paymentStatus: paymentIntent.status,
      paymentReference: paymentIntent.reference,
    },
    include: { items: true },
  });

  await createNotification({
    userId,
    type: "ORDER_CONFIRMED",
    message: `Your order #${order.id.slice(-6)} has been placed.`,
    link: `/orders/${order.id}`,
  });

  await notifyAdminsOfEvent("NEW_ORDER", {
    message: `New order #${order.id.slice(-6)} placed - $${(order.totalCents / 100).toFixed(2)}.`,
    link: "/admin/orders",
  });

  // Runs after the transaction commits, never inside it - a notification
  // failure here must not roll back a paid order.
  for (const change of stockChanges) {
    await checkStockThresholds(change.productId, change.productName, change.previousStock, change.newStock);
  }

  return orderWithPayment;
}

/** Lists a user's own orders, most recent first, paginated. */
export async function listOrdersForUser(userId: string, query: { page: number; pageSize: number }) {
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.order.count({ where: { userId } }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/**
 * Lists every order in the system, including the owning user's basic info
 * (admin use), optionally filtered by a search term (matches the order's
 * id or its customer's name/email), an exact status, and/or a
 * `[fromDate, toDate]` creation-date range, and sorted by date, status, or
 * customer name. Still deliberately unpaginated - `AdminOrders.tsx` has no
 * pagination UI (see `CLAUDE.md`) - filtering/sorting just narrows or
 * reorders the same full result set.
 */
export async function listAllOrders(query: {
  search?: string;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  sortBy: (typeof ORDER_SORT_FIELDS)[number];
  sortOrder: "asc" | "desc";
}) {
  const where: Record<string, unknown> = {};
  if (query.status === "EARNED") {
    // Same three statuses revenue.service.ts's own "earned" bucket uses -
    // AdminRevenue.tsx's "View orders" button on the Earned card links here.
    where.status = { in: EARNED_ORDER_STATUSES };
  } else if (query.status) {
    where.status = query.status;
  }
  if (query.fromDate || query.toDate) {
    const createdAt: Record<string, Date> = {};
    if (query.fromDate) createdAt.gte = query.fromDate;
    // Inclusive of the whole `toDate` day, not just up to midnight at its start.
    if (query.toDate) createdAt.lt = new Date(query.toDate.getTime() + 24 * 60 * 60 * 1000);
    where.createdAt = createdAt;
  }
  if (query.search) {
    where.OR = [
      { id: { contains: query.search } },
      { user: { name: { contains: query.search } } },
      { user: { email: { contains: query.search } } },
    ];
  }

  // Sorting by "customer" orders by the related user's name - Prisma
  // supports ordering by a to-one relation's field directly. An orphaned
  // order (`user: null`, see the `Order.userId` schema comment) sorts by
  // however the database places a NULL relation - not specially handled,
  // since there's no "right" position for a deleted account's name.
  const orderBy = query.sortBy === "customer" ? { user: { name: query.sortOrder } } : { [query.sortBy]: query.sortOrder };

  return prisma.order.findMany({
    where,
    include: { items: true, user: { select: { id: true, email: true, name: true } } },
    orderBy,
  });
}

/**
 * Fetches an order by id, if the requester owns it or is an admin. Includes
 * the same basic `user` fields `listAllOrders()` does (id/email/name, not
 * the full row) - the customer-facing `OrderDetail.tsx` doesn't render
 * this, but `AdminOrderInvoice.tsx` needs it to show who the order belongs
 * to, and without it `order.user` was always `undefined` here regardless
 * of whether the account still exists, making every invoice wrongly show
 * "Deleted user".
 * @throws {AppError} 404 if it doesn't exist, 403 if the requester isn't allowed to view it.
 */
export async function getOrder(id: string, requester: { id: string; role: string }) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, user: { select: { id: true, email: true, name: true } } },
  });
  if (!order) throw AppError.notFound("Order not found");
  if (!isAdminRole(requester.role) && order.userId !== requester.id) throw AppError.forbidden();
  return order;
}

/**
 * Re-sends an order's invoice to its customer (admin only - see the route's
 * `authorize("ADMIN")`). Rather than a real email (see the
 * in-app-notifications-only domain invariant), this creates a fresh
 * `ORDER_CONFIRMED` in-app notification linking back to the order - the
 * customer can already view/print their own invoice from there any time,
 * so in-app delivery isn't genuinely impossible here the way it is for a
 * password reset or the registration OTP; it doesn't warrant a third
 * `NotificationService` exception. Reuses `ORDER_CONFIRMED` (not a new
 * `NotificationType`) so it stays under the customer's existing
 * `ORDER_UPDATES` preference.
 * @throws {AppError} 404 if the order doesn't exist, 409 if the order's
 * account has since been deleted (see the `Order.userId` `onDelete:
 * SetNull` schema comment - there's nobody left to notify).
 */
export async function resendInvoice(id: string) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw AppError.notFound("Order not found");
  if (!order.userId) throw AppError.conflict("This order's account has been deleted - there's no one to notify.");

  await createNotification({
    userId: order.userId,
    type: "ORDER_CONFIRMED",
    message: `Your invoice for order #${order.id.slice(-6)} has been resent.`,
    link: `/orders/${order.id}`,
  });
}

/**
 * Updates an order's status, payment method, and/or payment currency
 * (admin only - see `updateOrderAdminFieldsSchema`), notifying the customer
 * only when the status actually changed (a payment-method/currency edit is
 * the admin's own bookkeeping, not something the customer needs an email
 * about).
 * **Payment method/currency can only be changed in the exact same request
 * that moves the order's status to CONFIRMED (i.e. paid) from some other,
 * not-yet-confirmed status** - not while it merely sits at PENDING with no
 * status change, and not anymore once it's actually been confirmed. This
 * is deliberately narrower than "any time before confirmed": recording how
 * an order was paid for only makes sense at the moment it's actually being
 * marked paid, and once that's saved, it becomes a locked historical fact
 * an admin can't silently rewrite later. Enforced here, not just by
 * `AdminOrders.tsx` disabling the two `<select>`s, since a disabled
 * control alone doesn't stop a direct API call. A request that *doesn't*
 * actually change either field (e.g. the client resending the same
 * already-saved value alongside an unrelated status change) is still
 * allowed through regardless - only an actual attempted change outside
 * that one window is rejected.
 * @throws {AppError} 404 if the order doesn't exist, 400 if this request
 * would change `paymentMethod` and/or `paymentCurrency` without also
 * moving the order's status to CONFIRMED from a non-CONFIRMED one.
 */
export async function updateOrderAdminFields(
  id: string,
  input: { status?: string; paymentMethod?: string | null; paymentCurrency?: string }
) {
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound("Order not found");

  const changesPaymentMethod = input.paymentMethod !== undefined && input.paymentMethod !== existing.paymentMethod;
  const changesPaymentCurrency = input.paymentCurrency !== undefined && input.paymentCurrency !== existing.paymentCurrency;
  const isConfirming = input.status === "CONFIRMED" && existing.status !== "CONFIRMED";
  if (!isConfirming && (changesPaymentMethod || changesPaymentCurrency)) {
    throw AppError.badRequest(
      "Payment method and currency can only be set in the same request that confirms the order."
    );
  }

  const order = await prisma.order.update({
    where: { id },
    data: input,
    include: { user: true },
  });

  // `order.userId` can be null - an order whose account has since been
  // deleted (see the `Order.userId` schema comment) is detached, not
  // deleted itself, but there's nobody left to notify about it.
  if (input.status && order.userId) {
    await createNotification({
      userId: order.userId,
      type: "ORDER_STATUS_UPDATED",
      message: `Your order #${order.id.slice(-6)} is now ${order.status}.`,
      link: `/orders/${order.id}`,
    });
  }

  return order;
}

/** Updates several orders' status at once (admin bulk action), notifying each affected customer. */
export async function bulkUpdateOrderStatus(ids: string[], status: string) {
  for (const id of ids) {
    await updateOrderAdminFields(id, { status });
  }
}

// Cancelling only makes sense before an order has physically shipped -
// once it's SHIPPED/DELIVERED there's nothing left to undo here, and a
// CANCELLED order obviously can't be cancelled again.
const CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED"];

/**
 * Cancels an order (the owning customer or an admin may do this) and
 * restores the stock its items reserved, all in one transaction so a
 * failure partway through can't leave stock counts inconsistent with the
 * order's status.
 * @throws {AppError} 404 if the order doesn't exist, 403 if the requester
 * doesn't own it and isn't an admin, 400 if it's already past the
 * cancellable stage (see {@link CANCELLABLE_STATUSES}).
 */
export async function cancelOrder(id: string, requester: { id: string; role: string }) {
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) throw AppError.notFound("Order not found");
  if (!isAdminRole(requester.role) && order.userId !== requester.id) throw AppError.forbidden();
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw AppError.badRequest(`An order that's already ${order.status.toLowerCase()} can't be cancelled.`);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: order.items.map((item) => item.productId) } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const [updatedOrder] = await prisma.$transaction([
    prisma.order.update({ where: { id }, data: { status: "CANCELLED" }, include: { items: true } }),
    ...order.items.map((item) =>
      prisma.product.update({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      })
    ),
  ]);

  // See updateOrderAdminFields()'s identical guard - order.userId can be
  // null for an order whose account has since been deleted.
  if (order.userId) {
    await createNotification({
      userId: order.userId,
      type: "ORDER_STATUS_UPDATED",
      message: `Your order #${order.id.slice(-6)} is now CANCELLED.`,
      link: `/orders/${order.id}`,
    });
  }

  // Runs after the transaction commits, never inside it - see createOrder()'s
  // identical comment on why.
  for (const item of order.items) {
    const product = productById.get(item.productId);
    if (!product) continue;
    await checkStockThresholds(
      product.id,
      product.name,
      product.stockQuantity,
      product.stockQuantity + item.quantity
    );
  }

  return updatedOrder;
}

/**
 * Permanently deletes one order and its line items (`OrderItem.order` is
 * `onDelete: Cascade`, so no separate item-deletion step is needed). This
 * is a genuine hard delete, not the cancel-and-keep-the-record pattern the
 * rest of this app uses everywhere else an order is "removed" (see
 * `cancelOrder()` above, and the `Order.userId` `onDelete: SetNull`
 * schema comment, both of which exist specifically to preserve the
 * financial/audit record) - a deliberate, explicit exception for admin
 * data cleanup, not a precedent to extend elsewhere without the same
 * reasoning. Deliberately does **not** restore stock or notify the
 * customer, unlike `cancelOrder()`: this is administrative record
 * deletion, not a business event, and the right stock adjustment (if any)
 * depends on the order's status in a way a blanket restore can't get right
 * (a still-PENDING order's items are still physically in the warehouse; a
 * DELIVERED order's aren't) - an admin who wants stock restored should
 * cancel the order first, then delete it.
 * @throws {AppError} 404 if the order doesn't exist.
 */
export async function deleteOrder(id: string) {
  try {
    await prisma.order.delete({ where: { id } });
  } catch {
    throw AppError.notFound("Order not found");
  }
}

/** Permanently deletes several orders at once (admin bulk action) - see {@link deleteOrder} for what this does and doesn't do. */
export async function bulkDeleteOrders(ids: string[]) {
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Permanently deletes **every** order in the system - the most destructive
 * action in this app, with no filter and no undo. Returns the number of
 * orders removed so the caller can report it back
 * (`AdminOrders.tsx` shows this in its confirmation and success toast).
 * See {@link deleteOrder} for why this doesn't touch stock or notify
 * anyone.
 */
export async function deleteAllOrders() {
  const { count } = await prisma.order.deleteMany({});
  return count;
}
