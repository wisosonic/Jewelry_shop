import { prisma } from "../../db/prisma";
import { EARNED_ORDER_STATUSES } from "../orders/orders.schema";
import { getSettings } from "../settings/settings.service";

/** Business logic for computing admin dashboard summary metrics. */

/**
 * Aggregates key business metrics: user/product counts, total revenue from
 * non-cancelled/pending orders, order counts by status, the 10 most recent
 * orders, and the active products at or below the store-wide low-stock
 * threshold (`Settings.lowStockThreshold`).
 */
export async function getSummary() {
  const [userCount, productCount, orders, statusGroups, settings] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    getSettings(),
  ]);

  const revenueResult = await prisma.order.aggregate({
    _sum: { totalCents: true },
    where: { status: { in: [...EARNED_ORDER_STATUSES] } },
  });

  const lowStockProducts = await prisma.product.findMany({
    where: { isActive: true, stockQuantity: { lte: settings.lowStockThreshold } },
    orderBy: { stockQuantity: "asc" },
  });

  return {
    userCount,
    productCount,
    totalRevenueCents: revenueResult._sum.totalCents ?? 0,
    ordersByStatus: Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])),
    recentOrders: orders,
    lowStockProducts,
  };
}
