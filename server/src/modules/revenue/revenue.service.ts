import { prisma } from "../../db/prisma";
import { EARNED_ORDER_STATUSES, PENDING_ORDER_STATUSES } from "../orders/orders.schema";

/** Business logic for the admin revenue report: totals, category breakdown, and a monthly trend. */

const RELEVANT_STATUSES: string[] = [...EARNED_ORDER_STATUSES, ...PENDING_ORDER_STATUSES];

function isEarned(status: string): boolean {
  return (EARNED_ORDER_STATUSES as readonly string[]).includes(status);
}

/** `"YYYY-MM"` bucket key for a date, in UTC so a server/DB timezone mismatch can't shift an order into the wrong month. */
function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `"YYYY-MM-DD"`, in UTC, for echoing a filter date back in the response. */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The first moment (UTC midnight) of the calendar month containing `date`. */
function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Aggregates revenue for the admin revenue page: totals split into "earned"
 * (order status CONFIRMED/SHIPPED/DELIVERED - money realized) vs "pending"
 * (PENDING - not yet realized), a per-category breakdown of the same split,
 * and a monthly earned/pending trend - by default the trailing `months`
 * months (including the current month), or, when `dateFilter` is given,
 * scoped to that exact `[fromDate, toDate]` range instead (`months` is
 * ignored in that case). CANCELLED orders are excluded entirely - they're
 * void revenue, not deferred revenue - matching `dashboard.service.ts`'s
 * existing `totalRevenueCents` definition, which `EARNED_ORDER_STATUSES`
 * is also the source of truth for. Only the *trend* is ever scoped by
 * `dateFilter` - the totals and category breakdown stay all-time
 * regardless, since `AdminRevenue.tsx`'s date-range filter is specifically
 * a trend-chart control (see that page's own doc comment).
 *
 * **The trend's bucket granularity is always whole calendar months, even
 * though `dateFilter` cuts on exact days** - `fromDate`/`toDate` bound
 * which *orders* are counted (precisely, down to the day, `toDate`
 * inclusive of its whole day - same convention `orders.service.ts`'s
 * `listAllOrders()` uses for its own date-range filter), while the set of
 * *bucket keys* pre-seeded spans every calendar month `fromDate` through
 * `toDate` touches at all. A range that starts or ends mid-month therefore
 * still shows a real bucket for that month, just totalling only the
 * in-range days within it - not the whole month's revenue.
 *
 * All amounts are summed from `Order.totalCents`/`OrderItem.lineTotalCents`,
 * always USD cents per the price-snapshotting domain invariant - never
 * recomputed from live prices, and never converted to LBP server-side.
 */
export async function getRevenueSummary(months: number, dateFilter?: { fromDate: Date; toDate: Date }) {
  // `queryStart`/`queryEnd` bound the actual order query, precise to the
  // day. `bucketStart`/`bucketMonthCount` bound which whole-month trend
  // keys get pre-seeded - always month-aligned, even when `dateFilter`
  // itself isn't.
  let queryStart: Date;
  let queryEnd: Date;
  let bucketStart: Date;
  let bucketMonthCount: number;

  if (dateFilter) {
    queryStart = dateFilter.fromDate;
    // Inclusive of the whole `toDate` day, not just up to midnight at its start.
    queryEnd = new Date(dateFilter.toDate.getTime() + 24 * 60 * 60 * 1000);
    bucketStart = startOfMonth(dateFilter.fromDate);
    const lastBucketMonth = startOfMonth(dateFilter.toDate);
    bucketMonthCount =
      (lastBucketMonth.getUTCFullYear() - bucketStart.getUTCFullYear()) * 12 +
      (lastBucketMonth.getUTCMonth() - bucketStart.getUTCMonth()) +
      1;
  } else {
    bucketStart = new Date();
    bucketStart.setUTCMonth(bucketStart.getUTCMonth() - (months - 1), 1);
    bucketStart.setUTCHours(0, 0, 0, 0);
    bucketMonthCount = months;
    queryStart = bucketStart;
    queryEnd = new Date(bucketStart);
    queryEnd.setUTCMonth(queryEnd.getUTCMonth() + months);
  }

  const [statusTotals, items, ordersInTrendRange] = await Promise.all([
    prisma.order.groupBy({
      by: ["status"],
      _sum: { totalCents: true },
      where: { status: { in: RELEVANT_STATUSES } },
    }),
    prisma.orderItem.findMany({
      where: { order: { status: { in: RELEVANT_STATUSES } } },
      select: {
        lineTotalCents: true,
        order: { select: { status: true } },
        product: { select: { productType: true, category: true } },
      },
    }),
    prisma.order.findMany({
      where: { status: { in: RELEVANT_STATUSES }, createdAt: { gte: queryStart, lt: queryEnd } },
      select: { status: true, totalCents: true, createdAt: true },
    }),
  ]);

  let totalEarnedRevenueCents = 0;
  let totalPendingRevenueCents = 0;
  for (const group of statusTotals) {
    const cents = group._sum.totalCents ?? 0;
    if (isEarned(group.status)) totalEarnedRevenueCents += cents;
    else totalPendingRevenueCents += cents;
  }

  const byCategory = new Map<
    string,
    { productType: string; category: string; earnedCents: number; pendingCents: number }
  >();
  for (const item of items) {
    const key = `${item.product.productType}:${item.product.category}`;
    const entry = byCategory.get(key) ?? {
      productType: item.product.productType,
      category: item.product.category,
      earnedCents: 0,
      pendingCents: 0,
    };
    if (isEarned(item.order.status)) entry.earnedCents += item.lineTotalCents;
    else entry.pendingCents += item.lineTotalCents;
    byCategory.set(key, entry);
  }

  // Pre-seed every month in range so the trend has no gaps for months with
  // no orders - a chart reading zero for a quiet month is meaningful, a
  // missing point isn't.
  const trend = new Map<string, { earnedCents: number; pendingCents: number }>();
  for (let i = 0; i < bucketMonthCount; i++) {
    const bucket = new Date(bucketStart);
    bucket.setUTCMonth(bucket.getUTCMonth() + i);
    trend.set(periodKey(bucket), { earnedCents: 0, pendingCents: 0 });
  }
  for (const order of ordersInTrendRange) {
    const bucket = trend.get(periodKey(order.createdAt));
    if (!bucket) continue;
    if (isEarned(order.status)) bucket.earnedCents += order.totalCents;
    else bucket.pendingCents += order.totalCents;
  }

  return {
    totalEarnedRevenueCents,
    totalPendingRevenueCents,
    revenueByCategory: Array.from(byCategory.values()).sort(
      (a, b) => b.earnedCents + b.pendingCents - (a.earnedCents + a.pendingCents)
    ),
    trend: Array.from(trend.entries()).map(([period, cents]) => ({ period, ...cents })),
    // The exact requested `[fromDate, toDate]` (`"YYYY-MM-DD"` each) when
    // `dateFilter` was given, `null` for the default trailing-window trend -
    // AdminRevenue.tsx uses this (not the trend array's own length or its
    // first/last period) to decide whether to show "Showing: <fromDate> -
    // <toDate>" above the chart and what exact dates to render there, so it
    // doesn't have to infer either from incidental data shape.
    filteredRange: dateFilter ? { fromDate: dateKey(dateFilter.fromDate), toDate: dateKey(dateFilter.toDate) } : null,
  };
}
