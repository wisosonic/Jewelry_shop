/** A pulsing gray placeholder block - compose with layout classes (width/height/rounding) to mimic the eventual content's shape. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-brand-100 ${className}`} aria-hidden="true" />;
}

/** Placeholder for one `ProductCard`, matching its aspect-square image + two text lines + price row layout. */
function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-brand-200 bg-white">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    </div>
  );
}

/**
 * A grid of `ProductCardSkeleton`s matching the product-grid layouts on
 * `Shop.tsx`/`BullionShop.tsx`/`Home.tsx`, shown in place of "Loading..."
 * text while the first page of results is in flight.
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Placeholder for `ProductDetail.tsx`'s image + title/price/details layout, shown while the product itself is loading. */
export function ProductDetailSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading product">
      <div className="grid gap-6 sm:grid-cols-2 sm:gap-10">
        <Skeleton className="aspect-square w-full rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="mt-4 h-20 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}

/** Placeholder for one order card on `OrderHistory.tsx`. */
function OrderCardSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-brand-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-6 w-2/3" />
    </div>
  );
}

/** A stack of `OrderCardSkeleton`s matching `OrderHistory.tsx`'s list, shown while the first page of orders is in flight. */
export function OrderListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading orders">
      {Array.from({ length: count }, (_, i) => (
        <OrderCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Placeholder for one row on `Notifications.tsx`. */
function NotificationRowSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-white p-4">
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

/** A stack of `NotificationRowSkeleton`s matching `Notifications.tsx`'s list, shown while the first page is in flight. */
export function NotificationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading notifications">
      {Array.from({ length: count }, (_, i) => (
        <NotificationRowSkeleton key={i} />
      ))}
    </div>
  );
}

/** Placeholder for `OrderDetail.tsx`'s header + item breakdown, shown while the order itself is loading. */
export function OrderDetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading order">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-1/2" />
      <Skeleton className="mt-2 h-4 w-1/3" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <Skeleton className="mt-8 h-24 w-full rounded-xl" />
    </div>
  );
}
