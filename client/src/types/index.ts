/**
 * Shared domain types mirrored from the API's response and request shapes.
 * Kept in one module so pages, API wrappers and stores agree on field names.
 */

/**
 * `SUPER_ADMIN` is a single, non-assignable role - `lib/roles.ts`'s
 * `isAdminRole()` treats it as having every `ADMIN` permission (see
 * CLAUDE.md's `SUPER_ADMIN` bullet). It never appears as an option in any
 * role-picking `<select>` (`AdminUsers.tsx`'s "Add user" form,
 * `AdminUserDetail.tsx`'s role select) - those only ever offer
 * `CUSTOMER`/`ADMIN`.
 */
export type Role = "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";

export type User = {
  id: string;
  /** Optional - self-registration only requires `phone`; an account can have neither, one, or both as its login identifier. */
  email?: string | null;
  name: string;
  role: Role;
  phone?: string | null;
  address?: string | null;
  /** Whether this account has completed OTP phone verification. `false` right after self-registration until `/verify-otp` succeeds - an unverified account can browse/log in but not place orders (see `Checkout.tsx`). */
  isVerified: boolean;
  /** Admin-set (Admin -> Users): blocks order placement only - a blocked account can still log in, browse, and manage its own profile. */
  isBlocked: boolean;
  /** Set on every successful password login, `null` if the account has never logged in (e.g. just registered, or admin-created). Never set by registration or by a silent refresh-token rotation. */
  lastLoginAt?: string | null;
  /** Admin-only: when the "your account will be deleted soon" warning was sent for a still-unverified account (see server `modules/accountCleanup`) - `null` until then. Absent (not present) on a customer's own view of themselves. */
  deletionWarningSentAt?: string | null;
  /** Private admin-only note about this customer - only ever present when the viewer is an admin; absent (not null) on a customer's own view of themselves. */
  adminNotes?: string | null;
  /** When this account was created. */
  createdAt: string;
};

// Every notification type this app creates. The last four only ever go to
// ADMIN-role users; the rest only to CUSTOMER-role users. A type is
// finer-grained than the *preference category* it's grouped under for
// enable/disable purposes - see `CustomerEventType` below (e.g.
// `ORDER_CONFIRMED`/`ORDER_STATUS_UPDATED` both fall under one
// "order updates" toggle, and `PASSWORD_CHANGED`/`NEW_LOGIN`/`PROFILE_UPDATED`
// under one "account activity" toggle).
export type NotificationType =
  | "ORDER_CONFIRMED"
  | "ORDER_STATUS_UPDATED"
  | "PASSWORD_CHANGED"
  | "NEW_LOGIN"
  | "PROFILE_UPDATED"
  | "ACCOUNT_DELETION_WARNING"
  | "WISHLIST_BACK_IN_STOCK"
  | "PROMOTION"
  | "PAYMENT_REMINDER"
  | "USER_SIGNUP"
  | "LOW_STOCK"
  | "CRITICAL_ERROR"
  | "NEW_ORDER";

/** An in-app notification - see `GET /notifications` and the bell icon in `Navbar.tsx`. */
export type Notification = {
  id: string;
  type: NotificationType;
  message: string;
  /** Optional client-side route to navigate to when clicked - absent for e.g. a broadcast promotion. */
  link?: string | null;
  isRead: boolean;
  createdAt: string;
};

/** The event categories an admin can individually configure, with a channel (see `AdminNotifications.tsx`). */
export type AdminEventType = "USER_SIGNUP" | "LOW_STOCK" | "CRITICAL_ERROR" | "NEW_ORDER";

/** One admin's delivery preference for a single event type - "NONE" means in-app only. */
export type AdminNotificationPreference = {
  eventType: AdminEventType;
  enabled: boolean;
  channel: "NONE" | "EMAIL" | "SMS";
};

/**
 * The event categories any user (customer or admin) can individually
 * enable/disable for themselves, in-app only - no channel, unlike
 * `AdminEventType` (see the "in-app only for regular users" rule in
 * CLAUDE.md). Coarser than `NotificationType`: `ORDER_UPDATES` covers both
 * `ORDER_CONFIRMED` and `ORDER_STATUS_UPDATED`; `ACCOUNT_ACTIVITY` covers
 * `PASSWORD_CHANGED`, `NEW_LOGIN`, and `PROFILE_UPDATED`. The rest map 1:1
 * with a `NotificationType` of the same name.
 */
export type CustomerEventType =
  | "ORDER_UPDATES"
  | "ACCOUNT_ACTIVITY"
  | "PROMOTION"
  | "ACCOUNT_DELETION_WARNING"
  | "WISHLIST_BACK_IN_STOCK";

/** One user's own preference for a single customer-facing category - in-app only, so no channel. */
export type NotificationPreference = {
  eventType: CustomerEventType;
  enabled: boolean;
};

export type ProductType = "JEWELRY" | "BULLION";
export type Category = "RING" | "NECKLACE" | "BRACELET" | "EARRING" | "BAR" | "COIN";
export type MetalType = "GOLD" | "SILVER";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  productType: ProductType;
  category: Category;
  metalType: MetalType;
  purity: number;
  weightGrams: number;
  makingChargeCents: number;
  currentPriceCents: number;
  stockQuantity: number;
  imageUrl?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Aggregate rating, attached wherever products are listed (not on a single `GET /products/:id`) - null when there are no reviews yet. */
  averageRating?: number | null;
  /** Aggregate review count, attached alongside `averageRating`; 0 when there are no reviews yet. */
  reviewCount?: number;
};

/** A single page of a paginated list endpoint's response. */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type OrderItem = {
  id: string;
  productId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPriceCentsSnapshot: number;
  metalPricePerGramCentsSnapshot: number;
  commissionCentsPerTroyOunceSnapshot: number;
  lineTotalCents: number;
};

export type OrderStatus = "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

/** How the customer actually paid, manually recorded by an admin once payment is collected out-of-band. */
export type PaymentMethod = "WHISH_MONEY" | "CASH_ON_DELIVERY";

/** The currency the customer actually paid in, manually recorded by an admin - distinct from the storefront's display-only LBP toggle. */
export type PaymentCurrency = "USD" | "LBP";

export type Order = {
  id: string;
  /** Null for an "orphaned" order whose account has since been deleted (see `Order.userId`'s server schema comment - the account is gone, the order survives). */
  userId: string | null;
  user?: { id: string; email: string | null; name: string } | null;
  status: OrderStatus;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  shippingAddress?: string | null;
  paymentProvider?: string | null;
  paymentStatus?: string;
  paymentReference?: string | null;
  /** Admin-set: how the customer actually paid (null until an admin records it). */
  paymentMethod?: PaymentMethod | null;
  /** Admin-set: the currency the customer actually paid in. Defaults to "USD" server-side. */
  paymentCurrency?: PaymentCurrency;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
};

/** One customer's order-activity summary, for the admin user-detail page's stat cards - see `GET /users/:id/order-summary`. */
export type UserOrderSummary = {
  /** Sum of `totalCents` across CONFIRMED/SHIPPED/DELIVERED orders - money actually realized, same "earned" definition `AdminRevenue.tsx` uses. */
  totalSpentCents: number;
  /** Sum of `totalCents` across PENDING orders - CANCELLED counts as neither. */
  totalPendingCents: number;
  lastOrder: Pick<Order, "id" | "status" | "totalCents" | "currency" | "createdAt"> | null;
};

export type MetalPrice = {
  id: string;
  metalType: MetalType;
  pricePerGramCents: number;
  currency: string;
  source: string;
  fetchedAt: string;
};

export type Settings = {
  id: number;
  /** Flat, fixed surcharge per troy ounce on the spot gold price when selling to a customer - not a percentage, not per gram; can be negative (a discount). Separate from the silver rate below - see the schema comment on `Settings.commissionSellingGoldCentsPerTroyOunce` on the server. */
  commissionSellingGoldCentsPerTroyOunce: number;
  /** Same as `commissionSellingGoldCentsPerTroyOunce`, but for silver products. */
  commissionSellingSilverCentsPerTroyOunce: number;
  /** Flat, fixed surcharge per troy ounce on the spot gold price when buying metal back - not a percentage, not per gram; can be negative (a discount). */
  commissionBuyingGoldCentsPerTroyOunce: number;
  /** Same as `commissionBuyingGoldCentsPerTroyOunce`, but for silver products. */
  commissionBuyingSilverCentsPerTroyOunce: number;
  currency: string;
  /** Display-only USD->LBP conversion rate for the storefront currency toggle - never used in any stored price. */
  usdToLbpRate: number;
  /** Inclusive stockQuantity threshold (at/below which a product shows up in the admin low-stock alert list). */
  lowStockThreshold: number;
  /** A deliberate OTP-verification bypass, admin-set - when non-null, this exact code verifies ANY user's account. `null` (the default) disables it. */
  universalOtpCode?: string | null;
  /** Master switch for the registration OTP flow. When `false`, new registrations skip OTP entirely and are created already verified - see the schema comment on `Settings.otpVerificationEnabled` on the server. Defaults `true`. */
  otpVerificationEnabled: boolean;
  /** Master switch for the automatic metal-price refresh (cron + boot fetch). Never affects the admin's manual "refresh now" button. Defaults `true`. */
  metalPriceScheduleEnabled: boolean;
  /** How often, in minutes (1-1440), the automatic refresh runs - also the minimum gap enforced between any two refreshes, manual or automatic. See the schema comment on `Settings.metalPriceRefreshFrequencyMinutes` on the server. Defaults `60`. */
  metalPriceRefreshFrequencyMinutes: number;
  updatedAt: string;
};

export type DashboardSummary = {
  userCount: number;
  productCount: number;
  totalRevenueCents: number;
  ordersByStatus: Record<string, number>;
  recentOrders: Order[];
  lowStockProducts: Product[];
};

/**
 * Admin revenue report: totals and a category/trend breakdown, each split
 * into "earned" (order status CONFIRMED/SHIPPED/DELIVERED - money realized)
 * vs "pending" (PENDING - not yet realized); CANCELLED orders are excluded
 * from both entirely. `trend` covers a trailing window of whole months
 * (including the current, in-progress one), one entry per month with no
 * gaps, oldest first - unless a specific `fromDate`/`toDate` range was
 * requested, in which case `trend` covers every calendar month that range
 * touches (still one entry per month, no gaps) and `filteredRange` echoes
 * the exact dates requested; only the trend is ever affected by the
 * filter, never the totals or `revenueByCategory`. A range that starts or
 * ends mid-month still shows a real bucket for that month, but totals only
 * the in-range days within it, not the whole month.
 */
export type RevenueSummary = {
  totalEarnedRevenueCents: number;
  totalPendingRevenueCents: number;
  revenueByCategory: {
    productType: string;
    category: string;
    earnedCents: number;
    pendingCents: number;
  }[];
  trend: {
    /** `"YYYY-MM"`. */
    period: string;
    earnedCents: number;
    pendingCents: number;
  }[];
  /** The exact requested `{ fromDate, toDate }` (each `"YYYY-MM-DD"`) when a date-range filter was requested, `null` for the default trailing-window trend. */
  filteredRange: { fromDate: string; toDate: string } | null;
};

export type Review = {
  id: string;
  productId: string;
  userId: string;
  user: { id: string; name: string };
  rating: number;
  comment?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewSummary = {
  reviews: Review[];
  averageRating: number | null;
  reviewCount: number;
};

/** One day's regular hours (`dayOfWeek`: 0=Sunday .. 6=Saturday, matching `Date.getDay()`); `openTime`/`closeTime` are "HH:MM" 24-hour strings. */
export type BusinessHours = {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

/** A dated exception to the regular weekly schedule (a holiday closure or special hours for one specific date). */
export type BusinessHoliday = {
  id: string;
  date: string;
  label: string;
  isClosed: boolean;
  openTime?: string | null;
  closeTime?: string | null;
};

/** Public storefront contact info, weekly hours, holiday exceptions, and the emergency override banner - see `GET /api/v1/business`. */
export type BusinessInfo = {
  address?: string | null;
  phone?: string | null;
  /** When true, `overrideMessage` should be shown as a site-wide warning banner instead of the regular schedule. */
  overrideActive: boolean;
  overrideMessage?: string | null;
  hours: BusinessHours[];
  holidays: BusinessHoliday[];
};
