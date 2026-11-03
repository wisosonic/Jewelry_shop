# CLAUDE.md

Guidance for Claude (or any AI coding assistant) working in this repository.

## What this project is

A two-tier jewelry e-shop: a React (Vite) client and a Node/Express API,
backed by Prisma/SQLite (designed to migrate to MySQL later). Public
storefront (browse, cart, checkout) + an admin interface (product/order/user
CRUD, commission and metal-price settings, sales dashboard). See `README.md`
for setup/run instructions and directory layout.

## Non-negotiable domain invariants

These encode explicit product requirements. Do not "simplify" or refactor
them away without checking with the user first:

1. **Price-at-purchase snapshotting.** `OrderItem` stores its own copy of
   `unitPriceCentsSnapshot`, `metalPricePerGramCentsSnapshot`, and
   `commissionCentsPerTroyOunceSnapshot` at creation time. Nothing about an
   existing order ever recomputes from live `Product`/`Settings`/`MetalPrice`
   data — that's the entire point (see `tests/orderSnapshot.test.ts`). If you
   touch `orders.service.ts`, keep this invariant intact.
   `commissionCentsPerTroyOunceSnapshot` is specifically whichever *selling*
   commission matches the product's own `metalType` — resolved via
   `settings.service.ts`'s `sellingCommissionForMetal(settings, metalType)`
   (`orders.service.ts`'s `createOrder()` calls it per order item, not a
   single shared field — see invariant #6 for why commission is now split
   by metal) — every order here is a sale to the customer, so the *buying*
   commission (`commissionBuyingGoldCentsPerTroyOunce`/
   `commissionBuyingSilverCentsPerTroyOunce`, what the store would pay to
   buy metal back) never applies to an `OrderItem` and isn't separately
   snapshotted. Both selling and buying, for both metals, are still shown
   together on `MetalPricesPanel` (see the architecture bullet below) since
   customers should be able to see the full commission structure, not just
   the half that applied to their own purchase. Note `unitPriceCentsSnapshot` is a
   copy of the product's already-cached `currentPriceCents` at order time
   (see invariant #5) — `createOrder()` does not call `computePriceCents()`
   itself.
2. **Money is integer cents**, never float/Decimal (SQLite has no Decimal
   type in Prisma; floats introduce rounding error). All `*Cents` fields
   follow this. Format for display with `formatCents` (client) — don't
   hand-roll `/100` formatting elsewhere.
3. **Role/status/category/metalType/productType fields are plain `String`**,
   not Prisma `enum` (SQLite has no native enum support in Prisma). Valid
   values are enforced with zod at the API boundary (`*.schema.ts` files),
   not at the DB layer. Keep new enum-like fields consistent with this.
   `Product.productType` (`JEWELRY` | `BULLION`, see the architecture bullet
   below) is the newest example — added as a String with a DB-level
   `@default("JEWELRY")`, not an enum.
4. **Metal price fetches are rate-limited by one admin-editable number**,
   `Settings.metalPriceRefreshFrequencyMinutes` (Int, default `60`, bounded
   1-1440 in `settings.schema.ts`), for the *automatic* scheduler's tick -
   both go through the same guard in `metals.service.ts`'s
   `refreshMetalPrices()`. Don't add a second code path that calls the
   metals.dev API without going through `refreshMetalPrices()`. This field
   replaced two previously separate, env-only, restart-required settings
   (`METALS_REFRESH_CRON` and `METALS_MIN_REFRESH_INTERVAL_MINUTES`, both
   now gone from `config/env.ts`) with one number that means exactly what
   it says, no hidden floor underneath it — see its Prisma schema comment
   for the full rationale.
   **The admin's manual "refresh now" button always passes `force: true`
   (`metals.controller.ts`) and completely bypasses this floor** - clicking
   it fetches immediately regardless of how recently a fetch happened,
   automatic or manual. This was a deliberate product decision: an admin
   explicitly asking for fresh prices right now is not something to
   silently throttle the same way an unattended background tick is. The
   real, accepted tradeoff is that repeated manual clicks each cost a real
   metals.dev API call with no throttle of their own - don't "fix" this by
   adding a limit back to the manual path, that would defeat the point of
   the button.
   **`metals.scheduler.ts`'s `startMetalsScheduler()` doesn't run on a
   fixed cron interval anymore** — it ticks every minute
   (`SCHEDULER_TICK_CRON = "* * * * *"`) via a shared `attemptScheduledRefresh()`
   helper (also called once on boot), and lets `refreshMetalPrices()`'s own
   rate-limit guard decide whether *this* tick is actually due. This means
   a changed `metalPriceRefreshFrequencyMinutes` takes effect on the very
   next tick (at most a minute later) with no server restart and no
   need to stop/recreate a differently-scheduled cron task — the
   alternative (reconstructing a cron expression from the admin's minutes
   value and swapping the running task) would need cross-module plumbing
   from `settings.service.ts` into the scheduler just to notify it of a
   change; ticking-and-checking avoids that entirely. A tick that isn't due
   yet (`refreshMetalPrices()` throwing its 429 `AppError`) is expected and
   silent - not logged as an error, since most ticks hit this on purpose;
   only a genuine failure (network error, bad API key, etc.) is logged.
   `Settings.metalPriceScheduleEnabled` (admin-set, default `true`) is a
   separate, earlier gate on top of this - `attemptScheduledRefresh()`
   checks it before *calling* `refreshMetalPrices()` at all, for both the
   tick and the boot-time check, and skips entirely (no call, not even one
   that would immediately 429) when it's `false`. The admin's manual
   "refresh now" button is a distinct call site (`metals.controller.ts`)
   that always calls `refreshMetalPrices({ force: true })` and is never
   gated by this setting either - disabling the schedule stops *automatic*
   refreshes, not an admin's explicit request for one. The two gates are
   both specific to the *automatic* path and layer independently there: the
   schedule flag decides whether the scheduler ever reaches
   `refreshMetalPrices()`; the rate limiter inside it then decides whether
   that particular tick is due. The manual button skips both - it's not
   gated by `metalPriceScheduleEnabled` and, via `force: true`, not gated
   by `metalPriceRefreshFrequencyMinutes` either. Don't move either
   automatic-path check into `refreshMetalPrices()` itself in a way that
   would also block a forced call, and don't remove the manual button's
   `force: true`, which is what "refresh now" actually working right now
   requires.
5. **Commission/settings changes reprice every product immediately**
   (`repriceAllProducts()`), but never touch historical orders (see #1).
6. **Commission is a flat, fixed surcharge quoted per troy ounce, not a
   percentage and not per gram — and is set independently per metal
   (gold vs. silver), not one shared rate.**
   `Settings` has four commission fields:
   `commissionSellingGoldCentsPerTroyOunce`,
   `commissionSellingSilverCentsPerTroyOunce`,
   `commissionBuyingGoldCentsPerTroyOunce`,
   `commissionBuyingSilverCentsPerTroyOunce` (`Int` cents — still integer
   cents per invariant #2, just denominated per troy ounce instead of per
   gram; can be negative — a discount — as well as positive — a markup).
   This replaced an earlier single
   `commissionSellingCentsPerTroyOunce`/`commissionBuyingCentsPerTroyOunce`
   pair applied uniformly to every product regardless of metal — a real
   product requirement (gold and silver commissions move independently in
   practice) that a hand-written migration (`prisma/migrations/
   20260909140447_split_commission_by_metal_type/migration.sql`, needed
   because this environment's non-interactive shell can't run the normal
   interactive `prisma migrate dev` confirmation for a destructive column
   drop) mapped into both new gold and silver columns at once, so an
   admin's already-configured rate is preserved for both metals
   immediately post-migration rather than reset to schema defaults.
   **`settings.service.ts`'s `sellingCommissionForMetal(settings,
   metalType)`/`buyingCommissionForMetal(settings, metalType)` are the one
   place that resolves which of the two per-metal fields applies** — a
   defensive `metalType === "SILVER" ? ... : ...` narrowing (mirroring the
   `productType === "BULLION" ? "BULLION" : "JEWELRY"` convention used
   elsewhere, per invariant #3's "plain `String`, not enum" note) that
   defaults to gold. `products.service.ts`'s `priceProductInput()`/
   `repriceAllProducts()` and `orders.service.ts`'s `createOrder()` all go
   through these two functions rather than reading a `Settings` commission
   field directly — don't read `settings.commissionSelling...`/
   `commissionBuying...GoldCentsPerTroyOunce` /
   `...SilverCentsPerTroyOunce` inline at a new call site; call the
   resolver instead so gold-vs-silver logic stays in one place.
   `pricing.ts`'s `computePriceCents()` itself stays metal-agnostic — it
   still just takes one resolved `commissionCentsPerTroyOunce` number; the
   caller decides which metal's rate that number is. They are quoted in
   the same unit gold/silver spot prices
   themselves are conventionally quoted in. Because the pricing formula
   multiplies by `weightGrams` (grams, not troy ounces), `pricing.ts`'s
   `computePriceCents()` first converts: `commissionPerGramCents =
   commissionCentsPerTroyOunce / GRAMS_PER_TROY_OUNCE`, then computes
   `((pricePerGramCents + commissionPerGramCents) * weightGrams * purity) +
   makingChargeCents` — **but only for `productType: "JEWELRY"`; a
   `BULLION` product's `makingChargeCents` is always treated as `0`
   regardless of what's stored in that column.** Bullion (bars/coins) is
   bought for its raw metal content, not crafted, so it has no
   labor/fabrication cost to recoup the way a jewelry piece does —
   `computePriceCents()` now takes a required `productType: "JEWELRY" |
   "BULLION"` param specifically to enforce this at the one place price is
   ever computed, rather than relying on every caller to zero the field out
   themselves. `AdminProductForm.tsx` hides the "Making charge" input
   entirely when `productType` is `BULLION` (and zeroes the in-memory form
   value when switching to it) so an admin can't set a charge that would
   silently do nothing; seeded bullion products (`prisma/seed.ts`) are
   seeded with `makingChargeCents: 0` for the same reason, even though the
   pricing formula would ignore a non-zero value there regardless.
   `GRAMS_PER_TROY_OUNCE = 31.1034768` is duplicated locally in
   `pricing.ts` (as well as in `metals.service.ts` and client
   `lib/format.ts` — see the "displayed per troy ounce" bullet below) since
   there's no shared package; keep all of them in sync if this ever changes.
   This used to be (in order) a `Float` percentage rate, then a cents-*per-
   gram* surcharge — if you're reading old code, commits, or docs that
   mention a "commission rate" as a fraction, or a cents-per-gram commission,
   that's stale on both counts. Validate with `z.number().int()`
   (`settings.schema.ts`), not `.min(0).max(1)` - bounded to
   `COMMISSION_CENTS_PER_TROY_OUNCE_MIN`/`_MAX` (-$5,000 to $5,000, shared
   via one `commissionField` zod const reused across all four fields in
   `settings.schema.ts`), a fat-finger backstop only (an extra zero, a
   misplaced decimal point) and not a policy limit on where an admin is
   allowed to price things - `AdminCommission.tsx` mirrors the same bounds
   client-side for all four inputs (duplicated, not shared - no shared
   package) for immediate feedback before the request round-trips. The
   admin form presents/edits this in whole-and-fractional dollars
   (`value / 100` in, `Math.round(value * 100)` out) since that's the
   natural unit for a "$ per troy ounce" fixed commission, while the wire
   format and the `Settings`/`OrderItem` columns stay integer cents.
   **Commission has its own dedicated admin page,
   `client/src/pages/admin/AdminCommission.tsx`
   (`/admin/commission`, linked from `AdminLayout.tsx`'s sidebar with
   `TagIcon`)** - originally a section inside `AdminSettings.tsx`, split out
   into its own page (not just its own section) since commission is the
   setting most likely to grow more controls over time (e.g. a per-category
   rate) and deserves a page of its own to grow into rather than sharing
   `AdminSettings.tsx` with unrelated store configuration. **Its layout is
   two side-by-side metal sections (Gold, Silver), each with its own
   selling and buying input** — a `metalFields()` helper renders one
   metal's pair with fully self-describing `<label>` text (e.g. "Gold
   selling commission ($ per troy oz)", not a generic "Selling" shared
   visually across both metals) — necessary once there are two of each
   input on the same page, both for accessibility and so
   `getByLabelText`-style test queries stay unambiguous — and one shared
   "Save commission" button submits all four fields together. It's still
   backed by the exact same `Settings` row and the same
   `fetchSettings()`/`updateSettings()` wrappers as everything else on that
   row - this was a UI/navigation split, not a new data model or a new API
   endpoint. `AdminSettings.tsx` itself now holds "Metal prices" (including
   the `metalPriceScheduleEnabled` toggle, domain invariant #4 - a single
   checkbox saved immediately on click rather than behind its own "Save"
   button, the same immediate-save pattern `AdminUsers.tsx`'s block/unblock
   quick action already uses, reverted back if the save request fails so
   the checkbox never shows a state the server doesn't actually have - and,
   next to it, the `metalPriceRefreshFrequencyMinutes` minutes input, which
   *does* get its own small "Save" button rather than immediate-save, since
   a text input mid-edit shouldn't fire a request on every keystroke; both
   controls mirror the server's 1-1440 bound client-side for immediate
   feedback), "Store settings" (currency exchange rate, low-stock
   threshold), and "OTP verification" (the store-wide on/off switch plus
   the universal bypass code) - three sections, no Commission section
   anymore.
7. **LBP is a display-only currency conversion, never stored or snapshotted.**
   `Settings.usdToLbpRate` (`Float`, admin-editable on `AdminSettings.tsx`) is
   used *only* to convert an already-computed USD-cents value for on-screen
   display when a shopper toggles the currency switch in `Navbar.tsx`
   (`store/currencyStore.ts`, `hooks/useDisplayPrice.ts`,
   `lib/format.ts`'s `formatDisplayPrice()`). No `Product`, `OrderItem`, or
   any other row ever stores an LBP amount — every domain calculation
   (pricing, snapshotting, totals) stays entirely in USD cents per invariant
   #2, exactly as before this feature existed. Admin screens intentionally
   never call `useDisplayPrice`/`formatDisplayPrice` and always show USD via
   `formatCents`, since store management (setting the commission, editing a
   product's making charge, reading `AdminOrders.tsx`) is a USD-denominated
   operation regardless of what a shopper is browsing in. If you add a new
   customer-facing price display, use `useDisplayPrice`; if you add a new
   admin-facing one, use `formatCents` directly — don't mix the two on the
   same kind of screen. `currencyStore.ts`'s `usdToLbpRate` is always kept
   fresh via `hooks/useCurrencyRateSync.ts`, called once from `Navbar.tsx`'s
   toggle (mounted for the whole app session) — don't rely solely on
   `MetalPricesPanel`'s incidental sync for this, since several
   customer-facing pages (Cart, Checkout, order history) never mount that
   component and would otherwise show conversions against the hardcoded
   fallback rate instead of the admin's current one. See the architecture
   bullet below for the currency toggle's persistence and UI.

8. **Unverified accounts are on a clock, and it's driven by one cutoff pair,
   not ad hoc date math.** `env.unverifiedAccountTtlDays` (default 14) and
   `env.unverifiedAccountWarningDaysBeforeDeletion` (default 3) together
   define the warning window `[ttl - warningDays, ttl)` days old and the
   deletion cutoff at `ttl` days old
   (`accountCleanup.service.ts`'s `warningWindowStart()`/`deletionCutoff()`).
   `User.deletionWarningSentAt` is set once a warning goes out and is the
   *only* thing that stops the daily job from re-warning the same account
   every day it sits in the window — never clear it manually, and don't add
   a second "already warned" signal. Deleting an unverified user can never
   violate the `Order.user` foreign key (no `onDelete: Cascade`) because
   `orders.service.ts`'s `createOrder()` already requires `isVerified`
   before any order can exist — if that check is ever removed or weakened,
   revisit `deleteExpiredUnverifiedAccounts()` too, since the safety
   argument depends on it.

9. **Regular (CUSTOMER-role) users get in-app notifications only - no email
   or SMS - with exactly two named exceptions that are not part of this
   rule at all.** Every event a customer can receive (`ORDER_CONFIRMED`,
   `ORDER_STATUS_UPDATED`, `PASSWORD_CHANGED`, `NEW_LOGIN`,
   `PROFILE_UPDATED`, `ACCOUNT_DELETION_WARNING`, `WISHLIST_BACK_IN_STOCK`,
   `PROMOTION`, `PAYMENT_REMINDER`) creates a `Notification` row and nothing else - this
   **replaced** what used to be an order-confirmation email, an
   order-status-update email, and an SMS+email account-deletion warning.
   Password-reset (`notification.service.ts`'s `sendPasswordReset()`) and
   the registration OTP (`sms.service.ts`'s `sendOtp()`) are **not**
   discretionary notifications and are deliberately untouched by this rule
   - they're the only way to reach a user who, by definition, isn't logged
   in (reset) or hasn't verified a channel yet (OTP); routing either
   through the in-app system would make the feature it belongs to stop
   working. Don't add a third "exception" without the same reasoning:
   something is exempt from in-app-only only if in-app delivery is
   literally impossible for it, not merely because email/SMS would also be
   nice. (`resetPassword()` *does* also fire an in-app `PASSWORD_CHANGED`
   notification once the reset completes - that's a discretionary
   heads-up, not a replacement for the reset email itself, which is how the
   user got there in the first place.)
   **`AdminOrders.tsx`'s "Resend invoice" button is a real, deliberate test
   of this rule, not an oversight** - `orders.service.ts`'s
   `resendInvoice()` (`POST /orders/:id/resend-invoice`, admin only) does
   *not* add a fourth `NotificationService` method; it creates a fresh
   `ORDER_CONFIRMED` in-app notification linking back to the order (reusing
   the existing type, not a new one, so it stays under the customer's
   existing `ORDER_UPDATES` preference). A resent invoice doesn't meet the
   "in-app delivery is literally impossible" bar the two real exceptions
   above do - the customer can already view/print their own invoice from
   their order any time - so it doesn't get a third exception either, even
   though "resend invoice" sounds email-shaped at first glance. 404s if the
   order doesn't exist, 409s if the order is orphaned (`Order.userId` is
   `null` - see the `onDelete: SetNull` schema comment in the admin
   user-management bullet further below - there's nobody left to notify).
   **`AdminUserDetail.tsx`'s "Send payment reminder" button (on the "Total
   spending" stat card, shown only when `totalPendingCents > 0`) is the
   same kind of deliberate test of this rule** - `users.service.ts`'s
   `sendPaymentReminder()` (`POST /users/:id/payment-reminder`, admin only)
   creates a new `PAYMENT_REMINDER` notification type, filed under
   `ORDER_UPDATES` (not its own category) since it's about the same kind of
   thing `ORDER_CONFIRMED`/`ORDER_STATUS_UPDATED` already are - an update
   about an order. A customer chasing their own unpaid order can already
   see it any time on `OrderHistory.tsx`, so this doesn't clear the
   "in-app delivery is literally impossible" bar either, and gets no third
   exception. The server re-derives the pending total itself from the exact
   same `PENDING_ORDER_STATUSES` bucket `getOrderSummary()` already sums
   (never trusts the client's own, possibly-stale copy of that number) and
   400s if it comes out to zero - 404 if the user doesn't exist at all.
   **Known, deliberately accepted tradeoff**: an unverified account that
   never opens the app again will never see its deletion warning before
   being deleted - a real regression from that warning's original
   SMS+email design, kept anyway because it's what this rule means taken
   literally (see `accountCleanup.service.ts`'s `sendDeletionWarnings()`
   doc comment).
   **Every `Notification.type` belongs to a coarser preference *category*,
   and every user - customer or admin - can enable/disable each category
   for themselves** (`NotificationPreference`, one row per `(userId,
   eventType)`; a missing row defaults to enabled). `ORDER_CONFIRMED`/
   `ORDER_STATUS_UPDATED` both fall under one `ORDER_UPDATES` category;
   `PASSWORD_CHANGED`/`NEW_LOGIN`/`PROFILE_UPDATED` fall under one
   `ACCOUNT_ACTIVITY` category; the rest map 1:1 onto a category of the
   same name (see `CATEGORY_BY_TYPE` in `inAppNotifications.schema.ts`).
   **`createNotification()` is the single enforcement point for this** -
   every trigger site in the app goes through it (directly, or via
   `notifyAdminsOfEvent()`/`sendBroadcastNotification()`), and it silently
   returns `null` instead of creating a row when the recipient has that
   category disabled. Don't hand-roll a second preference check anywhere
   else - if a new event type needs one, give it a `CATEGORY_BY_TYPE`
   entry and let `createNotification()` handle the rest.
   The customer-facing preferences panel (`Notifications.tsx`, CUSTOMER-role
   viewers only) only ever sends `{eventType, enabled}` - no channel, since
   regular users stay in-app-only per the rule above.
   **ADMIN-role users get an *additional* channel on top of the same
   enabled/disabled mechanism** (this now means `ADMIN` *and* `SUPER_ADMIN`
   - `notifyAdminsOfEvent()`'s admin lookup queries `role: { in:
   ADMIN_ROLES }`, not a literal `"ADMIN"` - see domain invariant #10):
   `USER_SIGNUP`, `LOW_STOCK`,
   `CRITICAL_ERROR`, and `NEW_ORDER` always create an in-app `Notification`
   for every admin whose preference for that event has `enabled: true`,
   and *additionally* email/SMS them via
   `notificationService.sendAdminAlert()`/`smsService.sendAdminAlert()`
   only when that preference's `channel` isn't `"NONE"` **and** their own
   `User.notificationMessagingEnabled` master switch is also on - both
   independently gate the external leg (see the two fields' schema
   comments); `enabled: false` suppresses the event for that admin
   entirely, including in-app. Preferences are per admin *account*, not a
   shared setting - two different admins can choose differently. All of
   this is centralized in one place, `notifyAdminsOfEvent()`
   (`modules/notifications/inAppNotifications.service.ts`) - trigger sites
   (`registerUser()`, `orders.service.ts`'s `createOrder()`,
   `products.service.ts`'s `checkStockThresholds()`, `errorHandler.ts`'s
   generic 500 branch) call it rather than hand-rolling the preference
   lookup/fan-out again. There is currently **no** admin-facing toggle for
   an admin's own `ACCOUNT_ACTIVITY` events (password changed/new
   login/profile updated on the admin's own account) - they're always
   enabled by the same default every category gets when no preference row
   exists; add one to `AdminNotifications.tsx` if that's ever asked for,
   rather than assuming it already exists.
   **"High-priority support tickets" was explicitly considered and
   dropped** - there's no ticketing feature anywhere in this app to
   generate that event from, so it was left out entirely rather than added
   as a dead, always-empty preference row. Don't add it back without a
   real ticketing feature behind it.
   Every notification-creating call in `auth.service.ts`/`users.service.ts`
   is **awaited, not detached fire-and-forget**, even though it's always
   `.catch(() => {})`'d so a notification failure can never fail the
   primary action - a genuine bug this session caught: a truly detached
   (`createNotification(...).catch(...)` without `await`) call races the
   HTTP response, and a test asserting the notification exists immediately
   after the response comes back can flake or fail outright. `await
   x.catch(() => {})` gets both properties at once (never throws, but the
   row exists before the caller's function returns). `notifyAdminsOfEvent()`
   is the one exception that's fine to leave undetached in
   `errorHandler.ts` specifically - a 500 response must never be delayed
   waiting on a notification write, and nothing there depends on the
   notification's timing the way a test does.
   Real-time delivery to a connected browser is Socket.IO
   (`src/realtime.ts`), authenticated with the same JWT access token as
   every HTTP request, joined to a room named `user:<id>` - this is what
   makes "only the corresponding user receives its notification" true.
   `initRealtime()` is only ever called from `index.ts`'s `app.listen()`
   equivalent, never from `app.ts` itself, so test files (which import
   `app` directly) never start a real socket server -
   `emitToUser()`'s `io?.` guard makes that a safe no-op rather than
   something tests need to account for.
   **Client UI split**: `Navbar.tsx`'s `NotificationBell` is a click-to-open
   dropdown (same click-outside/Escape pattern as `AccountMenu`) previewing
   the 5 latest notifications (fetched fresh on each open, not kept live
   while open - the badge count is the only thing that updates live via the
   socket) with a "View all" link to `/notifications`; `Notifications.tsx`
   is the full paginated feed; `/notifications/preferences`
   (`NotificationPreferences.tsx`, reached via a gear icon on
   `Notifications.tsx`, CUSTOMER-role viewers only) is the five-category
   enable/disable page. All three read/mark-read through the same
   `src/api/notifications.ts` wrappers - don't duplicate that fetch/mark
   logic a fourth time if you add another notification-adjacent surface.
   **Deletion is a genuine `DELETE`, not a soft `isRead`-style flag** -
   `DELETE /notifications/:id` (one, ownership-checked the same way
   `markNotificationRead()` is) and `DELETE /notifications` ("clear all",
   every one of the caller's notifications regardless of read status - not
   scoped to unread, unlike `markAllRead()`) both hard-delete the row via
   Prisma. Only `Notifications.tsx` exposes this today (a small "x" per
   row, no confirmation - a quick, low-stakes action; a "Clear all" link,
   which *does* confirm via `useConfirm()` since it's an irreversible bulk
   action, mirroring `AdminUsers.tsx`/`AdminProducts.tsx`'s bulk-delete
   confirms) - the `NotificationBell` dropdown preview intentionally
   doesn't get delete buttons, to keep that surface a lightweight preview.
   The row markup is a plain `<div>` wrapping two sibling `<button>`s (the
   message/open action and the delete "x"), not one button nested inside
   another - nested interactive elements are invalid HTML and break click
   handling; if you touch this row again, keep them as siblings.

10. **`SUPER_ADMIN` is a third, single, non-assignable role that has every
    `ADMIN` permission plus the ability to manage other admin accounts -
    it is not a fourth thing to reason about at most call sites, because
    the hierarchy is enforced in exactly two places.** `User.role` is still
    a plain `String` (invariant #3) with three values now:
    `server/src/utils/roles.ts` (mirrored client-side by
    `client/src/lib/roles.ts`) is the one shared source of truth - `ROLES`
    (all three), `ASSIGNABLE_ROLES` (`CUSTOMER`/`ADMIN` only - see below),
    `ADMIN_ROLES` (`ADMIN`/`SUPER_ADMIN`), and `isAdminRole()`. Don't
    hardcode a third `"ADMIN"`/`"SUPER_ADMIN"` string-literal comparison
    anywhere new - import `isAdminRole()` (or, for a route, rely on
    `authorize()` below) instead.
    - **Permission hierarchy, enforced once, not at every call site.**
      `middleware/auth.ts`'s `authorize(...roles)` treats a route gated
      with just `authorize("ADMIN")` as satisfied by `SUPER_ADMIN` too -
      this is the *only* place that rule lives, so none of this app's
      ~20 `authorize("ADMIN")` route registrations needed to change to
      also list `"SUPER_ADMIN"`. The handful of service-level
      `role === "ADMIN"` checks that aren't expressed as route middleware
      (`orders.service.ts`'s `createOrder()`/`getOrder()`/`cancelOrder()`,
      `orders.controller.ts`'s `list()`, `wishlist.service.ts`'s
      `addToWishlist()`, `products.service.ts`'s `listProducts()`'s
      `includeInactive` gate, `notifyAdminsOfEvent()`'s admin lookup, and
      `users.service.ts`'s `selectFor()`/`users.controller.ts`'s
      `assertSelfOrAdmin()`/`update()`) all call `isAdminRole()` instead of
      comparing to the raw string - a `SUPER_ADMIN` account is, e.g., still
      blocked from placing orders/using the wishlist (those aren't
      permissions either admin tier has), but does inherit `includeInactive`
      product visibility, admin-event notifications, and `adminNotes`
      visibility the same way a plain `ADMIN` does. Client-side,
      `ProtectedRoute.tsx`'s `matchesRoleGate()` gives `role="ADMIN"` (the
      `/admin/*` routes) and `excludeRole="ADMIN"` (the shopping-only
      routes) the identical hierarchy, and `Navbar.tsx`/`Login.tsx`/
      `Profile.tsx`/`ProductCard.tsx`/`ProductDetail.tsx`'s own
      admin-detection all go through `isAdminRole()` too - a `SUPER_ADMIN`
      account is treated exactly like an `ADMIN` one for every one of
      these UI checks, since none of them are the "manage other admins"
      permission (the one thing that *does* distinguish the two tiers -
      see the next bullet).
    - **Only the super admin can manage another admin account - a plain
      `ADMIN` cannot, even though it can manage every `CUSTOMER` and its
      own account.** `users.service.ts`'s `assertCanManageTarget(requester,
      target)` is the single enforcement point: a no-op for a `SUPER_ADMIN`
      requester (unrestricted) or when `requester.id === target.id`
      (self-service is a different rule, handled by
      `users.controller.ts`'s `update()` field-stripping); otherwise, if
      the requester is a plain `ADMIN` and `target.role !== "CUSTOMER"`, it
      403s. Called from `getUser()`, `updateUser()`, and `deleteUser()` -
      the three functions that actually constitute "managing" a specific
      account (viewing, editing/blocking/role-changing, deleting).
      Deliberately *not* called from `getOrderHistory()`/`getOrderSummary()`/
      `sendPaymentReminder()` - moot in practice, since `createOrder()`
      already blocks every admin-tier account from ever placing an order
      (see the bullet above), so an admin/super-admin target can never
      actually have any order data to protect there. Note `getUser()` (`GET
      /users/:id`) has no role restriction *at all* for who may call it -
      any authenticated user, even a `CUSTOMER`, can view another user's
      *public* fields (pre-existing behavior, unrelated to this invariant,
      not fixed here) - `assertCanManageTarget()` only ever blocks a plain
      `ADMIN` requester specifically, leaving that unrelated pre-existing
      permissiveness untouched. Promoting a `CUSTOMER` to `ADMIN`, or
      creating a brand new `ADMIN` account, is *not* restricted to the
      super admin - the target is a `CUSTOMER`/nonexistent at the moment of
      that request, so it doesn't trip this rule; only *already-admin*
      targets are protected. Client-side, `AdminUsers.tsx`'s `canManage()`
      mirrors the exact same three-way check (super admin / self / target
      is a customer) to decide, per row, whether to render the name as a
      link + show Block/Delete, or plain text + a "Restricted" label with
      an explanatory tooltip - this is a UI convenience only, the server
      check above is what actually stops a direct API call.
    - **At most one `SUPER_ADMIN` can ever exist - by construction, not a
      runtime uniqueness check.** `ASSIGNABLE_ROLES` (`CUSTOMER`/`ADMIN`
      only) is what `createUserSchema`/`adminUpdateUserSchema` validate
      `role` against - `"SUPER_ADMIN"` is a 400 from either endpoint, so
      nothing reachable through the API can ever grant it.
      `listUsersQuerySchema`'s `role` *filter* is the one exception,
      validated against the full `ROLES` instead - filtering by a role
      isn't granting one, and it's reasonable for an admin to be able to
      look up who the super admin is this way (`AdminUsers.tsx`'s role
      filter dropdown has a "Super Admin" option for exactly this).
      `prisma/seed.ts`'s admin-user upsert is the *only* other writer of
      `User.role`, and it's the one place `"SUPER_ADMIN"` is ever actually
      set (both its `create` and `update` branches, so re-running the seed
      against a database where this account still predates the role
      promotes it rather than leaving it behind) - don't add a second seed
      path or a manual DB script that also writes this value. If a genuine
      second way to reach `SUPER_ADMIN` is ever added, add a real
      uniqueness check at that point; until then, the guarantee holds
      purely because no code path can write it except this one upsert.
    - **`SUPER_ADMIN` never appears as a `<select>` option, anywhere.**
      `AdminUsers.tsx`'s "Add user" form and `AdminUserDetail.tsx`'s "User
      role" card both only ever offer `CUSTOMER`/`ADMIN` - consistent with
      `ASSIGNABLE_ROLES` above, this isn't just a client nicety, the server
      would reject it either way. When the loaded target user *is* the
      super admin (reachable only by the super admin viewing their own
      profile - a plain `ADMIN` can't even load that page, per the bullet
      above), `AdminUserDetail.tsx` renders a fixed "Super Admin (fixed)"
      label instead of a `<select>`, rather than trying to pre-select an
      option that was never in the list.

## Architecture conventions already in place

- **Layering (server)**: `routes → controller → service`, with Prisma calls
  living in services (no repository layer on top of Prisma — that would be a
  redundant abstraction). Validation happens in `middleware/validate.ts` via
  zod schemas per module (`<module>.schema.ts`), before the controller runs.
  `validate()`'s schemas are typed as `ZodTypeAny` (not `AnyZodObject`), so a
  schema built with `.refine()`/`.transform()` for cross-field checks (e.g.
  `business.schema.ts`'s "override message required when override is
  active") works too — the middleware only ever calls `.parse()`, which
  every Zod schema type supports.
- **Auth**: short-lived JWT access token returned in the response body (kept
  in memory client-side, never localStorage) + a rotated refresh token in an
  HttpOnly/Secure/SameSite cookie scoped to `/api/v1/auth`, hashed at rest in
  `RefreshToken`. `authenticate`/`authorize(...roles)` middleware in
  `middleware/auth.ts` — don't invent a second auth mechanism.
  `config/env.ts` refuses to boot in production if `JWT_ACCESS_SECRET`/
  `JWT_REFRESH_SECRET` are a known placeholder or under 32 characters
  (`assertProductionSafeSecret()`) — a pre-launch audit's top finding was
  that nothing previously stopped the committed `change-me-*` dev secrets
  from reaching production, where anyone who knew them could forge an
  admin-role token. `verifyAccessToken()` also explicitly pins
  `algorithms: ["HS256"]` (defense-in-depth, not a live fix — `jsonwebtoken`
  already restricted this for a string secret).
  **Refresh-token *reuse* (replaying a token that was already revoked
  *before* the request even started reading it) revokes every other
  session for that account**, not just the one request
  (`rotateRefreshToken()`) — the classic signal of a stolen token being
  replayed after the legitimate device already rotated past it. Still
  returns the same generic 401 either way, so there's no information leak
  about *why* a refresh failed.
  **This is deliberately distinct from two requests racing to rotate the
  *same*, not-yet-revoked token at the same instant** - a real scenario a
  pre-launch-adjacent bug fix caught, not just a theoretical one: React
  StrictMode double-invokes effects in dev, so `AuthContext.tsx`'s
  mount-time silent refresh alone could fire two real `POST /auth/refresh`
  calls back to back for the same cookie; two browser tabs refreshing
  around the same moment hit the identical shape of race. A plain
  read-then-write here let both requests pass the revoked/expired checks
  and both attempt to rotate, and whichever's write landed second would
  then see the first's revocation and misidentify a benign race as reuse -
  nuking the *winner's own brand-new session* along with everything else,
  for a race that was never an attack. `rotateRefreshToken()` closes this
  with an atomic conditional `updateMany` (`where: { id, revokedAt: null
  }`) immediately before issuing the new session, mirroring the OTP
  attempts-cap's own atomic-increment pattern elsewhere in this file - only
  one concurrent caller can win it, and the loser fails this call cleanly
  (a plain 401, no mass revocation) rather than triggering the reuse
  branch. Two independent layers now guard against this: `lib/api.ts`'s
  `refreshAccessToken()` de-duplicates concurrent refresh calls into one
  shared in-flight promise client-side (covering the same-tab/StrictMode
  case before it ever reaches the network), and the atomic claim above
  covers whatever client-side dedup can't reach (genuinely separate tabs).
  `tests/api/auth.test.ts` has a dedicated test that fires two real
  concurrent `POST /auth/refresh` requests for the same token and asserts
  neither the winner's new session nor an unrelated second session gets
  revoked - this test fails (confirmed by temporarily reverting the atomic
  claim) without the fix.
  A third-party middleware, `optionalAuthenticate` (`middleware/auth.ts`),
  exists alongside `authenticate` for routes that are genuinely public but
  need to behave differently for a *recognized* admin without forcing
  every visitor to log in — currently only `GET /products`'s
  `includeInactive` flag (products.controller.ts passes `req.user?.role`
  into `listProducts()`, which only honors that flag when it's `"ADMIN"`)
  — a pre-launch audit found this flag had no role check at all, letting
  anyone list deactivated/hidden products. Use this pattern (not a bespoke
  role check) if another public route ever needs the same shape of
  admin-only behavior.
  **Password minimum is 10 characters** (`registerSchema`,
  `resetPasswordSchema`, `updateProfileSchema` in their respective
  `*.schema.ts` files, plus matching `minLength`/placeholder text on every
  client password `<input>`) — bumped from 8 in a pre-launch audit; keep
  both layers in sync if this changes again, and check
  `DEFAULT_TEMP_PASSWORD` (`users.service.ts` and, duplicated client-side,
  `AdminUsers.tsx` — no shared package to hold one copy) and
  `SEED_ADMIN_PASSWORD`'s fallback (`prisma/seed.ts`) still satisfy
  whatever the new minimum is, since neither goes through the zod schema.
- **Image uploads (`modules/uploads/uploads.routes.ts`) validate actual
  file content, not the client-declared MIME type or filename.** A
  pre-launch audit found the original check only inspected `file.mimetype`
  (a request header the caller fully controls) while deriving the stored
  extension from `file.originalname` (also caller-controlled) — an admin
  session could upload a file named `x.png` with a spoofed `image/png`
  header whose real content was an SVG carrying a `<script>` tag, get it
  stored as `.svg`, and have it execute as script for anyone who opened
  the URL directly (served by `express.static` with
  `crossOriginResourcePolicy: cross-origin`). Fixed by buffering the
  upload in memory (`multer.memoryStorage()`, not `diskStorage`) and
  sniffing its actual magic bytes (`detectImageExtension()`) before ever
  writing to disk — the *detected* type, never the declared one, decides
  both whether the upload is accepted and what extension gets written.
  Keep this ordering (content-sniff before writing to disk) if you touch
  this route; don't go back to trusting `file.mimetype`/`originalname`.
- **API versioning**: all routes are mounted under `/api/v1` in `app.ts`.
  New routes go under the same `v1` router unless a breaking change
  genuinely requires `/api/v2`.
- **Future integrations are adapters, not TODOs**: `PaymentProvider`
  (`modules/payments`) and `NotificationService` (`modules/notifications`)
  are interfaces with a no-op/manual implementation today; `SmsService`
  (`modules/sms`) follows the same pattern but *is* wired to a real
  provider (Twilio, for the registration OTP - see the OTP bullet below),
  just one that gracefully no-ops to a console log when unconfigured. When
  wiring in Stripe/SendGrid (or a Twilio account with real credentials)
  later, implement the interface and swap the exported singleton — don't
  change call sites in `orders.service.ts`/`auth.service.ts`.
- **Client state**: `AuthContext` (React context) for auth, Zustand for the
  cart (`store/cartStore.ts`), the display-currency preference
  (`store/currencyStore.ts`), and the notification system's unread
  count/live socket connection (`store/notificationStore.ts` - not
  persisted, unlike `cartStore`, since it's live per-session state, not
  something that should survive across accounts on a shared browser).
  `notificationStore`'s `connect()`/`load()`/`disconnect()` are called from
  `AuthContext.tsx` at the exact same four points `wishlistStore`'s
  `load()`/`clear()` already are (silent-refresh success, `login()`,
  `register()`, `logout()`) - a new store that needs to hydrate/reset in
  lockstep with the signed-in user should follow this same wiring rather
  than inventing its own lifecycle hook. Don't introduce Redux for this
  app's current scope.
- **The currency preference persists in a cookie, not `localStorage`.**
  `currencyStore.ts`'s `persist` middleware is configured with a custom
  `storage: createJSONStorage(() => cookieStorage)` (`lib/cookieStorage.ts`,
  a minimal `getItem`/`setItem`/`removeItem` adapter over `document.cookie`,
  1-year `max-age`, `SameSite=Lax`) — this was a deliberate, explicit product
  requirement ("persist across sessions" via a cookie), so don't
  "simplify" it back to the default `localStorage` adapter `cartStore.ts`
  uses. Only `currency` is persisted (`partialize`); `usdToLbpRate` is never
  written to the cookie, since it's always re-fetched live (previous
  invariant) — a cached rate could otherwise go stale across sessions.
  `Navbar.tsx`'s `CurrencyToggle` renders this as an actual toggle switch
  (`role="switch"`, `aria-checked`, a sliding thumb) rather than a
  two-button pair — keep that semantics/markup if you touch it, since a
  switch is the correct accessible pattern for a two-state on/off
  preference.
- **Client HTTP**: all calls go through `src/lib/api.ts` (axios instance with
  the access-token interceptor and silent-refresh-on-401 logic). Add new
  per-resource wrappers under `src/api/`, don't call axios directly from
  components/pages. **Every caller that needs a fresh access token goes
  through `refreshAccessToken()`, never `api.post("/auth/refresh")`
  directly** - it shares one in-flight request across concurrent callers
  (`AuthContext.tsx`'s mount-time silent refresh, and this file's own
  response interceptor on a 401) rather than letting each fire its own
  network call, closing a real race with the server's refresh-token-reuse
  detection - see the "Refresh-token reuse" bullet above for the full
  story. If you add a third call site that needs to refresh the access
  token, route it through this same function.
- **Metal price + commission + "last updated" display is one shared
  component**: `client/src/components/metals/MetalPricesPanel.tsx`
  (variants `"hero"` for the landing page, `"compact"` for the shop listing,
  product detail page, and admin dashboard/settings) is the only place that
  fetches `GET /api/v1/metals/latest` and formats the relative timestamp
  (`formatRelativeTime` in `lib/format.ts`). That endpoint is intentionally
  public (no auth) and returns both spot prices *and* the current
  `commissionSellingGoldCentsPerTroyOunce`/
  `commissionSellingSilverCentsPerTroyOunce`/
  `commissionBuyingGoldCentsPerTroyOunce`/
  `commissionBuyingSilverCentsPerTroyOunce` — all four raw per-metal fields,
  unresolved (this is the one place gold and silver commission are shown
  side by side, so there's no single metal to resolve down to via
  `sellingCommissionForMetal()`/`buyingCommissionForMetal()`, unlike
  `products.service.ts`/`orders.service.ts` — see domain invariant #6) —
  `metals.service.ts`'s `getLatestPrices()` reads them via
  `settings.service.ts`'s `getSettings()` rather than duplicating that
  lookup. Both variants render commission **inline per metal row** (each
  gold/silver row shows its own selling/buying commission next to its own
  spot price), not as one combined line below both prices. The values
  themselves are still only *editable* through the admin-only
  `PATCH /api/v1/settings` (`AdminCommission.tsx`); this just makes the read
  side public since a customer comparison-shopping needs to see the
  commission that's baked into every price, not just the admin. Since these
  are already quoted per troy ounce (not percentages, and not per gram — see
  domain invariant #6) and can be negative, display them with
  `formatSignedCommissionPerTroyOunce` (`lib/format.ts`) — it does **not**
  multiply by `GRAMS_PER_TROY_OUNCE` (unlike `formatCentsPerTroyOunce`,
  which converts a per-*gram* value) and always renders an explicit `+`/`-`
  sign so a markup vs. a discount is unambiguous, unlike `formatCents`'s
  implicit sign on negative values alone. If a new screen needs to show
  *current* gold/silver
  prices or commissions, reuse this component rather than re-fetching or
  re-formatting inline — `AdminSettings.tsx` is the one exception, since it
  already has its own `prices` state for the refresh-now flow and just adds
  the same `formatRelativeTime` call directly. This is distinct from
  displaying a *historical* snapshot from an order (next bullet) — those
  never go through this component, since they must never re-fetch the live
  price.
- **Order price-snapshot fields are exposed all the way to the client, not
  just stored**: `client/src/pages/OrderDetail.tsx` (route `/orders/:id`,
  linked from `OrderHistory.tsx` and from `Checkout.tsx`'s post-purchase
  redirect) and `AdminOrders.tsx` both render each order item's
  `metalPricePerGramCentsSnapshot` and `commissionCentsPerTroyOunceSnapshot`
  directly from the `Order`/`OrderItem` API response — the metal price
  converted to per-troy-ounce for display (`formatCentsPerTroyOunce`, which
  multiplies by `GRAMS_PER_TROY_OUNCE`) and the commission formatted as-is
  (`formatSignedCommissionPerTroyOunce`, no conversion, since it's already
  per troy ounce), exactly like the live-price panel, but from the snapshot
  fields, never from `GET /api/v1/metals/latest`. If you add another
  order-related screen that shows pricing, pull from the order's own
  snapshot fields, not the live metals endpoint — that's the whole point of
  domain invariant #1.
- **Displayed metal prices are per troy ounce, stored/calculated per
  gram** — these are two different units on purpose. `MetalPrice.pricePerGramCents`
  is the unit the pricing formula multiplies by `weightGrams` (domain
  invariant #2), so it must never change; the UI converts to troy ounces
  only at render time via `formatCentsPerTroyOunce` in `lib/format.ts`
  (`GRAMS_PER_TROY_OUNCE = 31.1034768`, the same constant
  `metals.service.ts` uses for the inverse conversion on the server). If
  you add another place that displays a metal price, convert for display
  there too rather than changing what's stored. Commission (domain
  invariant #6) is the mirror image of this: it's *stored* per troy ounce
  and converted to per-gram only internally, inside `pricing.ts`, for the
  formula's multiplication — don't confuse the two directions.
- **The catalog has two product types sharing one `Product` table**:
  `productType` (`JEWELRY` | `BULLION`) sits alongside `category` — `JEWELRY`
  products use `RING`/`NECKLACE`/`BRACELET`/`EARRING`, `BULLION` products
  (bars/coins) use `BAR`/`COIN` (`CATEGORIES_BY_TYPE` in
  `AdminProductForm.tsx` keeps the admin dropdown from offering a mismatched
  pair). They're otherwise identical rows — same `Product`/`OrderItem`
  shape, same cart/checkout path — so cart, checkout, and order
  snapshotting needed **no** changes to support bullion; only the
  catalog-browsing layer is type-aware. The one deliberate pricing
  difference: `pricing.ts`'s `computePriceCents()` only applies
  `makingChargeCents` for `JEWELRY` (see domain invariant #6) — bullion is
  priced purely from metal value plus commission, no making charge, since
  it's bought for its raw metal content rather than crafted. `client/src/pages/Shop.tsx` (jewelry,
  `/shop`) and `client/src/pages/BullionShop.tsx` (bullion, `/bullion`,
  linked from the navbar right after Home, and from a CTA button on
  `Home.tsx`'s hero section, above the "Shop the collection" button) both
  call the same `GET /api/v1/products` with a fixed `productType` filter —
  don't let one leak into the other's results. `productListQuerySchema`
  (`products.schema.ts`) also accepts
  `weightGrams` (exact-match filter) and
  `sortBy`/`sortOrder` (`"price"` or `"weight"`, `products.service.ts`'s
  `listProducts()` turns that into the Prisma `orderBy`) — `BullionShop.tsx`
  is the one screen that exposes these in the UI, since bullion is
  comparison-shopped by weight/price far more than jewelry is; add them to
  `Shop.tsx` too if jewelry ever needs the same.
- **Account/order-history pages are split by responsibility, not bundled
  into one "profile" page**: `client/src/pages/Profile.tsx` (`/profile`)
  holds the editable profile form, the change-password form, and its own
  sign-out button; `client/src/pages/OrderHistory.tsx` (`/orders`) is a
  separate page listing the user's orders, linking into `OrderDetail.tsx`
  per order. The navbar (`Navbar.tsx`) shows only the signed-in user's name
  with a click-to-open dropdown (`AccountMenu`, closes on outside click)
  linking to `/profile`, `/orders`, `/wishlist`, and `/admin` for admins,
  plus its own "Log out" item at the bottom — both the dropdown's and
  `Profile.tsx`'s logout buttons call the same `useAuth().logout()` and then
  redirect home, so there are two entry points to the same action, not two
  mechanisms. If you add another account-related screen, link it from the
  dropdown and/or `Profile.tsx` rather than growing the navbar's own
  top-level markup.
- **Changing your own password requires the current password; an admin
  resetting someone else's does not.** `PATCH /api/v1/users/:id` accepts an
  optional `password` (and, for self-service changes, `currentPassword`).
  `users.controller.ts`'s `update()` only sets `requireCurrentPassword` when
  `req.user.id === req.params.id`; `users.service.ts`'s `updateUser()` then
  verifies `currentPassword` against the stored hash with `verifyPassword`
  before hashing and saving the new one, throwing 401 `AppError.unauthorized`
  on a mismatch. An admin editing a *different* user's record (e.g. from
  `AdminUsers.tsx`) skips that check entirely — there's no "current password"
  to know in that case. If you add another password-changing entry point,
  route it through this same `updateUser()` option rather than re-hashing
  inline.
- **An admin can create a user directly (`POST /api/v1/users`,
  `AdminUsers.tsx`'s "Add user" form), separate from self-registration.**
  `users.service.ts`'s `createUser()` fills in two defaults when the admin
  leaves them blank, since there's no email/SMS delivery in this app to
  send real credentials with: `email` becomes a slug of `name` on the
  store's own domain (`emailFromName()`, de-duplicated with a numeric
  suffix — `"John Doe"` → `john.doe@nayasofia.com`, then
  `john.doe2@nayasofia.com`, etc. — if the plain slug is already taken),
  and `password` becomes the shared constant `DEFAULT_TEMP_PASSWORD`
  (`"User@12345"`). An explicitly-given `email` is still validated as
  unique (409 if taken) rather than silently falling back to a generated
  one. `role` defaults to `CUSTOMER`. The admin is responsible for passing
  the assigned email/password to the new user out of band — the response
  (and `AdminUsers.tsx`'s success toast) surfaces both so there's something
  to copy. **An admin *can* change a user's email later** (`AdminUserDetail.tsx`,
  see the dedicated user-management bullet below) — `adminUpdateUserSchema`
  accepts `email`, and `updateUser()` checks for a conflicting existing
  user the same way `createUser()` does, throwing 409 rather than letting
  a duplicate hit the column's raw unique constraint. Self-service profile
  edits still can't touch `email` - only `adminUpdateUserSchema` has the
  field, not the base `updateProfileSchema` both share.
- **Admin user management is split across three pages - a list, a detail
  view, and a dedicated order-history view - `AdminUsers.tsx`
  (`/admin/users`), `AdminUserDetail.tsx` (`/admin/users/:id`, opened by
  clicking a name in the list, or an order's customer name on
  `AdminOrders.tsx`), and `AdminUserOrders.tsx` (`/admin/users/:id/orders`,
  reached via the detail page's "Last order" stat card).** The list's
  `<table>` is deliberately **read-only text, with no `<select>`/`<textarea>`
  editors in it** - name/email/role/status/last-login/admin-note are all
  plain cells (the admin note is truncated with a `title` tooltip for the
  full text, since it can run long); only a Block/Unblock button and
  Delete remain as real controls, next to the row - both are further
  replaced with a plain "Restricted" label, and the name with plain text
  instead of a link, for any row a plain `ADMIN` viewer isn't allowed to
  manage (`canManage()`; see domain invariant #10's "only the super admin
  can manage another admin account" bullet). This used to have an
  inline role dropdown and an inline admin-notes textarea-plus-Save-button
  per row too - removed on purpose, since editing role or the note now
  always means clicking through to the detail page below, keeping the list
  a fast, scannable overview rather than a table full of live form
  controls. The detail page opens with a 7-card stats sub-header - **total
  spending** (earned vs. still-pending, from `GET /users/:id/order-summary`,
  `users.service.ts`'s `getOrderSummary()`, plus a "Send payment reminder"
  button shown only when there's a nonzero pending amount - see the
  `sendPaymentReminder()` bullet under domain invariant #9 above),
  **registration date**
  (`User.createdAt`), **last login** (`User.lastLoginAt`, "Never" if
  unset), **last order** (from the same summary call, plus a "View order
  history" link to `AdminUserOrders.tsx` - always shown, even with zero
  orders), **account status** (`isBlocked`-driven Active/Blocked, with the
  block/unblock control inline), **OTP verification** (`isVerified`-driven
  Verified/Not verified, with its own immediate-save `<select>` - see the
  manual-override bullet in the registration/OTP architecture bullet
  further below for what flipping it actually does), and **user role** (an
  immediate-save `<select>`, no confirmation - the same immediate-save-select
  pattern the OTP-verification card right next to it uses) - below that, a
  plain profile form (name/email/phone/address/admin notes only; role
  moved out to its own card above, so it isn't edited in two places with
  two different save semantics), and delete. The order-history page itself is just the table
  that used to live inline on the detail page, moved out once the stats
  sub-header made this page too long - it still calls the same
  `GET /users/:id/orders` / `users.service.ts`'s `getOrderHistory()`
  the detail page used to call directly. All three pages call the same
  `updateUser()`/`deleteUser()` service functions - don't add a fourth
  place that edits a user. `getOrderSummary()` deliberately reuses
  `revenue.service.ts`'s `EARNED_ORDER_STATUSES`/`PENDING_ORDER_STATUSES`
  classification (CONFIRMED/SHIPPED/DELIVERED "earned", PENDING "pending",
  CANCELLED neither) rather than re-deriving it, so "earned vs pending" has
  one definition shared by the store-wide revenue report and this per-user
  view (see the "Earned vs pending revenue" architecture bullet below) -
  and is a separate, lighter query than `getOrderHistory()` (a status-
  grouped sum plus the single most recent order, no line items), since the
  stats cards don't need a full order+items list the way the history page
  does.
  **`User.isBlocked`** (admin-set, either surface) restricts *only* order
  placement - `orders.service.ts`'s `createOrder()` throws 403 the same
  way the `isVerified` check right above it does, with its own distinct
  message. A blocked account is otherwise unaffected: it can still log in,
  browse, and edit its own profile - this is not a general
  account-suspension switch, the same distinction `isVerified` already
  draws for itself. `users.controller.ts`'s `update()` strips `isBlocked`
  from a non-admin caller's body the same way it already strips a smuggled
  `role`/`adminNotes`/`email` - self-service can never unblock itself.
  Blocking asks for confirmation client-side (`useConfirm()`, a punitive,
  customer-impacting action); unblocking doesn't (purely restorative).
  **Deleting a user with existing orders used to crash** - `Order.userId`
  had no `onDelete` clause while every other `User` relation cascaded, so
  the foreign-key constraint blocked (and threw an unhandled error for)
  deleting anyone who'd ever placed an order. Fixed at the schema level:
  `Order.userId` is now nullable with `onDelete: SetNull` - deleting a
  user always succeeds, and their orders survive, detached
  ("orphaned", `userId`/`user` both `null`) rather than deleted, preserving
  the financial/audit record. `getOrder()`/`cancelOrder()`'s ownership
  checks (`order.userId !== requester.id`) already correctly deny every
  non-admin once `userId` is `null` - nobody but an admin can act on an
  orphaned order - and `updateOrderAdminFields()`/`cancelOrder()` skip
  sending the customer a status-change notification for one (`if
  (order.userId) { ... }`), since there's no longer an account to notify.
  `AdminOrders.tsx` shows "Deleted user" in place of the missing
  name/email for an orphaned order rather than rendering blank - otherwise,
  the customer name on each row links to `/admin/users/:id`
  (`AdminUserDetail.tsx` above). Each row also has a "Resend invoice"
  button (`POST /orders/:id/resend-invoice`, admin only - see the
  in-app-notifications bullet below) and a "Print invoice" link opening
  `AdminOrderInvoice.tsx` (`/admin/orders/:id/invoice`) in a new tab - a
  minimal, print-ready single-order view mirroring the customer-facing
  `OrderDetail.tsx`'s own `window.print()` + `print:hidden` pattern.
  **That invoice route is deliberately a top-level route in `App.tsx`, not
  nested under the `/admin` layout block** - nesting it there would wrap it
  in `AdminLayout`'s sidebar/topbar chrome via that route's `<Outlet />`,
  which would then also print; a top-level sibling route skips that
  `Outlet` entirely, so no chrome needs hiding to make printing work
  correctly. `fetchOrder()`/`getOrder()` already has no ownership
  restriction for `role === "ADMIN"` (only the *customer-facing*
  `/orders/:id` route is blocked for admins via `excludeRole="ADMIN"`, per
  the shopping-features-hidden-from-admins bullet further below) - this new
  route reuses that same already-permissive server endpoint via a
  different, admin-only client route, rather than relaxing the customer
  route's guard. **`getOrder()`'s Prisma query must include `user` (the
  same `{ id, email, name }` select `listAllOrders()` already uses), not
  just `items`** - it was originally written only for the customer-facing
  `OrderDetail.tsx`, which never renders `order.user` at all, so the
  omission went unnoticed until `AdminOrderInvoice.tsx` started relying on
  the same endpoint and every invoice wrongly showed "Deleted user" for
  real, non-deleted accounts (`order.user` was simply always `undefined`,
  indistinguishable from a genuinely orphaned order). If you add another
  admin-facing consumer of `getOrder()`, don't assume its current shape
  covers what you need - check what's actually included.
- **`AdminOrders.tsx` can permanently delete orders - single, several at
  once, or every order in the system - and this is a genuine, deliberate
  exception to how this app otherwise treats order history.** Everywhere
  else an order is "removed" (cancelling, or deleting the account that
  placed it - see the `Order.userId` `onDelete: SetNull` paragraph just
  above), the record survives specifically to preserve the financial/audit
  trail. This feature does the opposite on purpose, at explicit admin
  request: `orders.service.ts`'s `deleteOrder(id)` / `bulkDeleteOrders(ids)`
  / `deleteAllOrders()` (`DELETE /orders/:id`, `POST /orders/bulk-delete`,
  `DELETE /orders/all` - all admin-only) issue real `prisma.order.delete`/
  `deleteMany` calls; `OrderItem.order` is `onDelete: Cascade`, so a
  deleted order's line items go with it, no separate cleanup needed. **Do
  not extend this hard-delete pattern to any other entity without the same
  explicit reasoning** - it deliberately breaks the "orders are an
  immutable financial record" assumption the rest of this codebase (and
  its revenue reports) relies on; a deleted order silently disappears from
  `AdminRevenue.tsx`'s historical totals with no trace it ever existed.
  **Deleting does not restore stock or notify the customer**, unlike
  `cancelOrder()` - see `deleteOrder()`'s doc comment for why a blanket
  stock restore can't be done correctly regardless of the order's status;
  an admin who wants both should cancel first, then delete. `bulk-delete`
  and `all` are both registered above the generic `/:id` routes in
  `orders.routes.ts`, per the bulk-route-ordering convention below - a
  literal `/all` or `/bulk-delete` segment would otherwise be swallowed by
  `DELETE /:id` with `id = "all"`/`"bulk-delete"`. Client-side, all three
  actions go through the same `useConfirm()` danger-styled confirmation
  every other destructive admin action in this app uses (see the
  `window.confirm()`-replacement bullet below) - "Delete all orders"
  specifically states the exact count of orders about to be destroyed in
  its confirmation message, since it has no filter and no undo.
- **`AdminOrders.tsx` also supports search, filtering, and sorting, server-side
  - the same query-param convention `GET /api/v1/users`/`GET /api/v1/products`
  already use (see the bullet right below), extended to `GET
  /api/v1/orders?all=true`.** `listOrdersQuerySchema` (`orders.schema.ts`)
  adds `search` (matches the order's own id, or its customer's name/email -
  case-sensitive `contains`, same SQLite limitation as everywhere else this
  pattern appears), `status` (an exact match against `ORDER_STATUSES`, or
  the pseudo-value `"EARNED"` - `ORDER_STATUS_FILTER_VALUES` -
  `listAllOrders()` resolves that one to `{ in: EARNED_ORDER_STATUSES }`
  instead of an exact match, reusing the exact same bucket
  `revenue.service.ts` already uses rather than re-deriving "earned" a
  second way; there's no `"PENDING"` pseudo-value needed since that bucket
  is already exactly one real status. This is what powers
  `AdminRevenue.tsx`'s "View orders" link on the Earned card - see that
  page's own bullet below), `fromDate`/`toDate` (a creation-date range - plain "YYYY-MM-DD" strings
  from an `<input type="date">`, `z.coerce.date()`'d server-side), and
  `sortBy`/`sortOrder` (`ORDER_SORT_FIELDS`: `createdAt` | `status` |
  `customer`, default `createdAt`/`desc` - unchanged from before this
  feature). **These five params are honored only on the admin `all=true`
  branch** (`orders.service.ts`'s `listAllOrders()`) - a customer's own
  paginated `GET /orders` (`listOrdersForUser()`) ignores them entirely,
  since a shopper's own order history has no need for filtering by
  customer. `toDate` is treated as inclusive of that whole day (`< toDate +
  24h`, not `<= toDate` at midnight) so picking the same day for both ends
  of the range still returns that day's orders. `sortBy: "customer"` orders
  by the related `User.name` directly (`orderBy: { user: { name:
  sortOrder } } }` - Prisma supports ordering by a to-one relation's field)
  - an orphaned order (`user: null`) isn't special-cased here, since
  there's no well-defined "right" position for a deleted account's name in
  a name sort. Client-side, `AdminOrders.tsx` mirrors `AdminUsers.tsx`'s
  exact filter-bar pattern: a debounced search input
  (`useDebouncedValue`), a status `<select>`, a combined `sortBy`+`sortOrder`
  `<select>` (`SORT_OPTIONS`, `"field-direction"` values split on load -
  same `SortValue` shape `AdminUsers.tsx` already uses), plus two
  `<input type="date">` fields for the range (new to this page - no other
  admin list has a date-range filter yet). Every one of these six pieces
  of state is a `useEffect` dependency that re-triggers `load()`, so
  changing any filter or the sort re-fetches immediately (search waits out
  its debounce first) - this list stays deliberately unpaginated (see the
  `fetchAllOrders()` bullet elsewhere in this doc), so filtering/sorting
  just narrows or reorders the one full result set rather than needing to
  reset a page number anywhere. **The status filter dropdown offers "Earned
  (Confirmed/Shipped/Delivered)" as an extra option on top of the five real
  statuses** (`STATUS_FILTER_VALUES = [...STATUSES, "EARNED"]`) - kept
  deliberately separate from `STATUSES` itself, which still backs the
  per-row and bulk status-*change* `<select>`s, since `"EARNED"` is
  something you can filter *by*, never a real value an order's own status
  can be *set to*. **This filter is also seeded once from the URL**
  (`useSearchParams()`, read only in `statusFilter`'s lazy `useState`
  initializer, never written back) so a `?status=EARNED`/`?status=PENDING`
  link - `AdminRevenue.tsx`'s "View orders" buttons - lands pre-filtered; an
  unrecognized `?status=` value is silently ignored rather than sent to the
  server. This is the first page in this client to read initial state from
  the URL at all (every other list's filters live purely in component
  state) - if another page ever needs the same "deep-link into a filtered
  view" capability, follow this same lazy-`useState`-from-`useSearchParams`
  pattern rather than inventing a different one.
- **`GET /api/v1/users` and `GET /api/v1/products` both support search,
  filtering, and sorting — reuse the existing query params rather than
  adding new ones.** Users: `search` (name/email, case-sensitive `contains`
  — SQLite has no `mode: "insensitive"`, unlike Postgres), `role`,
  `sortBy`/`sortOrder` (`users.schema.ts`'s `USER_SORT_FIELDS`:
  name/email/createdAt). Products: `search` (name/description),
  `category`/`metalType`/`productType`, `minPriceCents`/`maxPriceCents`,
  `sortBy`/`sortOrder` (price/weight) — all of this already existed for the
  storefront's `Shop.tsx`/`BullionShop.tsx` before `AdminProducts.tsx`
  started using it too, so no backend changes were needed to add filtering
  to the admin products list, only to the admin users list (which had no
  filtering at all before).
- **`AdminProducts.tsx` is one page with an All/Jewelry/Bullion tab
  strip**, not three separate routes — switching tabs just sets the
  `productType` filter (and clears `category` if it no longer applies to
  the new tab) and re-fetches, the same list/filter/pagination state
  underneath. `client/src/lib/catalog.ts`'s `CATEGORIES_BY_TYPE` (moved
  here from being a local constant in `AdminProductForm.tsx`) is the
  shared source of truth for which categories belong to which product
  type — use it rather than hand-listing categories again if you add
  another category-aware screen.
- **`User.adminNotes` is role-gated at the `select` level, not filtered out
  after the fact.** `users.service.ts` has two Prisma `select` shapes -
  `publicSelect` and `adminSelect` (`publicSelect` plus `adminNotes`) -
  picked by `selectFor(viewerRole)`. `listUsers()` (an admin-only route)
  always uses `adminSelect`; `getUser()`/`updateUser()` (used by both
  self-service and admin callers on the same `GET`/`PATCH /users/:id`
  routes) take the viewer's role and pick accordingly, so a customer
  viewing or updating their own profile never receives `adminNotes` in the
  JSON at all - not just a value hidden client-side. `users.controller.ts`
  additionally strips `adminNotes` from a non-admin's request body before
  it reaches the service, mirroring exactly how it already strips a
  smuggled `role`. If you add another admin-only user field, follow this
  same two-select pattern rather than returning everything and relying on
  the client not to render it.
- **An order's `paymentMethod`/`paymentCurrency` are manually admin-set
  bookkeeping fields, not part of the payment adapter or the LBP display
  toggle.** `Order.paymentMethod` (`"WHISH_MONEY" | "CASH_ON_DELIVERY"`,
  nullable) and `Order.paymentCurrency` (`"USD" | "LBP"`, defaults `"USD"`)
  are set only via the admin-only `PATCH /api/v1/orders/:id`
  (`orders.schema.ts`'s `updateOrderAdminFieldsSchema`,
  `AdminOrders.tsx`). They are deliberately separate from:
  - `Order.paymentProvider`/`paymentStatus` - owned by the
    `PaymentProvider` adapter (`payment.service.ts`) and set automatically
    at order creation; don't repurpose these for the admin's manual
    payment-method selection, and don't let `updateOrderAdminFields()`
    touch them.
  - `Order.currency` - the order's pricing/snapshot currency (always
    `"USD"` today, tied to `subtotalCents`/`totalCents` per the
    price-snapshotting invariant). `paymentCurrency` never feeds into any
    price calculation; it's purely a label for what currency the admin
    actually collected payment in.
  - The storefront's LBP display toggle (`currencyStore.ts`) - that's a
    client-only, never-persisted-server-side conversion for browsing.
    `paymentCurrency` is a real, stored `Order` column but still only ever
    holds a currency *code*, never a converted amount - it doesn't violate
    the "LBP is display-only" invariant above, since no LBP amount is ever
    computed or stored anywhere because of it.
  Updating either field never sends the customer a status-change
  notification (`updateOrderAdminFields()` only calls
  `notificationService.sendOrderStatusUpdate()` when `status` was part of
  the request) - a payment-method edit is the admin's own bookkeeping, not
  customer-facing news.
  **`paymentMethod`/`paymentCurrency` can only be *set* in the exact same
  request that confirms the order** - i.e. one that both changes `status`
  to `"CONFIRMED"` *and* moves it there from something other than
  `"CONFIRMED"`. Not "any time before confirmed" (a PENDING order sitting
  untouched can't have its payment fields edited either) and not anymore
  once it's actually been confirmed - only the single moment of confirming
  it. Once confirmed, how it was paid for is a locked historical fact, the
  same "don't silently rewrite a past record" spirit as price-at-purchase
  snapshotting (domain invariant #1), even though this isn't itself a
  snapshotted field. Enforced in `orders.service.ts`'s
  `updateOrderAdminFields()`: it fetches the order's *current* (pre-update)
  status first, computes `isConfirming = input.status === "CONFIRMED" &&
  existing.status !== "CONFIRMED"`, and 400s if that's `false` **and** the
  request would actually change `paymentMethod` and/or `paymentCurrency`
  from what's already stored - re-sending the same already-saved value
  (e.g. because the client always submits all three staged fields
  together, see the bullet below) is a harmless no-op and still allowed
  regardless of `isConfirming`, only a genuine attempted change outside
  that window is rejected. `AdminOrders.tsx` mirrors this exact condition
  client-side (`paymentFieldsEnabled()`: the row's *staged* Status
  `<select>` reads `"CONFIRMED"` while the order's own last-*saved* status
  doesn't) rather than any simpler "is PENDING" check, disabling both
  `<select>`s (with an explanatory `title` tooltip) everywhere else,
  including while the order is simply sitting at PENDING with no staged
  status change. The disabled `<select>`s are cosmetic, not the real guard
  - the server-side 400 is what actually stops a direct API call from
  bypassing this.
- **`AdminOrders.tsx` stages status/payment-method/payment-currency edits
  locally and commits them with an explicit "Save" button**, rather than
  saving on every dropdown change (the old behavior for status, before this
  was added). Each row's three `<select>`s are bound to a local `edits`
  map, and a `isDirty()` check (comparing staged values against the order's
  last-saved ones) is what shows/hides the Save button - don't wire a
  `<select>`'s `onChange` straight to an API call here again; other admin
  screens with immediate-save selects (e.g. `AdminUsers.tsx`'s role
  dropdown) are a different, intentionally-immediate pattern and don't need
  to switch to this one unless asked. (The payment-method/currency
  `<select>`s are additionally disabled outright outside the
  about-to-be-confirmed window - see the bullet above.)
- **Business info (contact details, weekly hours, holiday exceptions, and
  the emergency override banner) is its own module, not folded into
  `Settings`.** `modules/business/` has three models: `BusinessInfo`
  (singleton, `id=1`, same pattern as `Settings` - address, phone,
  `overrideActive`/`overrideMessage`), `BusinessHours` (always exactly 7
  rows, one per `dayOfWeek` 0-6 matching JS `Date.getDay()`, replaced all
  together via `PUT /business/hours` rather than edited row-by-row, so the
  week can never end up with a missing day), and `BusinessHoliday` (any
  number of dated exceptions, added/removed individually via
  `POST`/`DELETE /business/holidays/:id`). `GET /api/v1/business` is
  public (no auth) - like `/metals/latest`, both the footer
  (`Footer.tsx`) and the site-wide banner (`OverrideBanner.tsx`) need it
  for signed-out visitors too - while every write is admin-only
  (`AdminBusinessInfo.tsx`, linked from `AdminLayout.tsx`'s sidebar).
  `business.service.ts`'s `getOrCreateInfo()` lazily seeds the singleton row
  and the 7 default `BusinessHours` rows on first read; **its result must be
  awaited before reading `BusinessHours`/`BusinessHoliday` separately, not
  raced in a `Promise.all`** - a real bug caught by this module's own tests,
  where the concurrent read could return an empty hours list if it resolved
  before the seed's `createMany` committed.
- **`OverrideBanner.tsx` has two independent triggers, not one.** (1)
  `BusinessInfo.overrideActive` is a manually-toggled on/off switch for an
  unplanned closure or special event with no pre-set date ("closed today",
  "leaving early") - it has no date scoping or auto-expiry, so an admin
  turns it off again by hand once it no longer applies. (2) A
  `BusinessHoliday` row whose `date` is *today* also shows the banner
  automatically (`lib/businessHours.ts`'s `findTodayHoliday()`) - a
  pre-planned exception (e.g. "closed for Christmas") still needs to warn a
  visitor arriving that day, not just appear as a line in the footer. If
  both happen to apply at once, the manual override's message wins. A
  `BusinessHoliday` for a *future* date only ever shows in the footer's
  "Upcoming exceptions" list (`Footer.tsx` filters `holidays` to
  `date >= today` client-side; the API returns all of them, past included,
  so the admin page can still manage/delete old ones) - it graduates to the
  banner only once its date arrives. Don't add a third ad hoc "closed today"
  code path; route any new same-day-closure signal through this component.
- **Password reset reuses the refresh-token pattern, not a new mechanism.**
  `PasswordResetToken` mirrors `RefreshToken`: a random opaque token is
  generated and emailed (`NotificationService.sendPasswordReset` — currently
  the console-log stub, per the adapter-pattern bullet above), while only its
  SHA-256 hash (`hashToken()`, shared with refresh tokens) is persisted.
  `auth.service.ts`'s `requestPasswordReset()` always resolves (204) whether
  or not the email is registered, so the endpoint never reveals which emails
  exist — don't add an early-return/error path that would leak this.
  `resetPassword()` is single-use (the token row is deleted/consumed on
  success) and additionally revokes every existing `RefreshToken` for that
  user, since a password reset is exactly the moment an account may have
  been compromised. Password reset has **no OTP/SMS step** of its own — it
  needs only email, a deliberate choice kept even after the registration
  OTP flow below was added, since a reset link's security already comes
  from the token itself, not a second channel. (An earlier Twilio/OTP
  integration existed once, was fully removed, and was later
  reintroduced — this time scoped specifically to registration - see the
  next bullet - not to password reset or login.)
- **Registration requires `phone` (unique) and verifies it via a 5-digit
  SMS OTP before the account can place an order; `email` is optional.**
  `User.isVerified` (`Boolean @default(true)`) starts `false` for a
  self-registered account and flips to `true` only once
  `POST /api/v1/auth/verify-otp` succeeds — `orders.service.ts`'s
  `createOrder()` is the only place this is enforced (403 if unverified);
  everything else (browsing, `GET /me`, even login) works the same
  regardless of verification status, per explicit product requirement
  ("limited access" means "can't buy," not "can't sign in"). `OtpCode`
  mirrors `PasswordResetToken`'s security shape (hashed at rest via the
  same `hashToken()`, single-use via `consumedAt`) with one deliberate
  difference: **it never expires** — a later, explicit product decision
  overriding the original design, so a shopper can activate their account
  whenever they get around to entering the code, no matter how much time
  has passed. `verifyOtp()` checks only correctness (hash match) and an
  `attempts` counter capped at `MAX_OTP_ATTEMPTS` (5) — no `expiresAt`
  check exists at all (there's no such column). That attempts cap is what
  actually bounds brute-forcing a non-expiring 5-digit code, alongside
  `authRateLimiter`'s general IP throttle on the route and the
  resend-specific protections below.
  **The increment-on-wrong-guess is an atomic conditional `updateMany`
  (`where: { id, attempts: { lt: MAX_OTP_ATTEMPTS } }`), not a plain
  `update()`** — a real race a pre-launch audit caught: several concurrent
  wrong guesses could all read the same pre-increment `attempts` value and
  all pass the cap check before any of their increments committed, letting
  an attacker exceed 5 guesses per code by firing requests concurrently.
  The `lt` condition is re-checked by the database at write time, so a
  request that loses the race affects zero rows and falls into the same
  "too many attempts" branch. Don't revert this to a read-then-write
  pattern.
  `auth.service.ts`'s `resendOtp()` invalidates every still-pending code
  for the user before issuing a new one, so at most one code is ever
  valid at a time. Codes are generated with `crypto.randomInt()`
  (`utils/otp.ts`), not `Math.random()`, since they're
  security-sensitive even with the attempt cap.
  **`verifyOtp()` never issues a replacement code itself, on any failure
  path** — resending only ever happens in direct response to the shopper
  clicking "resend" (`resendOtp()`), never automatically. The two failure
  cases where retrying the same code entry can't possibly help (no
  pending code, or attempts exhausted) are flagged with `AppError`'s
  `details: { requiresResend: true }`, which `errorHandler.ts` already
  serializes onto every error response — `VerifyOtp.tsx` checks this flag
  to swap the code-entry form for a dedicated "request a new code"
  prompt, rather than leaving a dead form next to a red error line. A
  plain wrong-guess (code just doesn't match) omits the flag, since
  retrying can still succeed there. If you add another OTP-adjacent error
  path, decide which bucket it belongs to and set (or omit)
  `requiresResend` accordingly — don't leave the client to guess from the
  message text.
  **Resending is throttled three independent ways, since a non-expiring
  code makes "request a new one" the main abuse lever left** (each resend
  also costs a real SMS via Twilio): (1) a per-account cooldown in
  `resendOtp()` itself (`env.otpResendCooldownSeconds`, default 60,
  measured from the previous `OtpCode.createdAt` regardless of its
  consumed/pending status) - the only one of the three that blocks rapid
  resends against one specific account no matter which IP they come from;
  (2) `otpResendRateLimiter`, a dedicated IP-based limiter stacked on that
  route specifically, tighter than the general `authRateLimiter` also
  still applied there; (3) the `attempts` cap above, which still limits
  how much a single surviving code can be brute-forced regardless of how
  many fresh ones get issued. A cooldown violation is a 429 carrying
  `details: { retryAfterSeconds }`; a successful resend responds `200`
  with `{ cooldownSeconds }` (not a bare `204`) so the client can start
  the same countdown proactively — `VerifyOtp.tsx` uses both to disable
  its resend button with a live countdown rather than a plain error.
  Because `email` is now optional, **login accepts either an email or a
  phone number in the same field** (`auth.schema.ts`'s `loginSchema`,
  `auth.service.ts`'s `loginUser()` queries `OR: [{email}, {phone}]`) —
  otherwise an emailless account would have no way to log back in. The
  client's login form still posts one field named `email` for this
  (relabeled "Email or phone number" in `Login.tsx`) rather than adding a
  second input, to avoid churn on the wire shape. Admin-created users
  (`users.service.ts`'s `createUser()`) are unaffected by any of this —
  OTP verification is scoped to *self*-registration only, so an
  admin-created account is always `isVerified: true` from the start.
  **An admin can also manually flip `isVerified` on an existing account**
  (`adminUpdateUserSchema`'s `isVerified` field, `PATCH /api/v1/users/:id`,
  admin only — `users.controller.ts`'s `update()` strips a smuggled
  `isVerified` from a non-admin caller's body the same way it already
  strips `role`/`adminNotes`/`isBlocked`/`email`). This is a direct write
  to the flag, not a re-run of the OTP flow — it doesn't touch any pending
  `OtpCode` row, doesn't check `attempts`, and doesn't care whether a code
  was ever issued. Surfaced on `AdminUserDetail.tsx`'s "OTP verification"
  stat card (next to "Account status") as an immediate-save `<select>` —
  same no-confirmation pattern as the "User role" card right next to it,
  not the confirm-before-block pattern the "Account status" card uses,
  since un-verifying an account isn't inherently punitive the way blocking
  is. Marking an account verified immediately unblocks order placement
  (`orders.service.ts`'s `createOrder()` reads `user.isVerified` fresh on
  every call); marking a verified account back to unverified re-blocks it,
  and also makes it immediately eligible for the unverified-account
  warning/deletion clock (domain invariant #8) based on its original
  `createdAt` — there's no separate "verification last changed" timestamp,
  so don't assume un-verifying an old account gives it a fresh grace
  period.
- **SMS delivery is a `SmsService` adapter (`modules/sms/sms.service.ts`),
  mirroring the `PaymentProvider`/`NotificationService` pattern.** The
  active implementation calls Twilio, but falls back to logging the OTP
  to the console — the same "not configured" convention
  `metals.service.ts` uses for `METALS_API_KEY` — whenever
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER` are unset
  *or* Twilio rejects them (e.g. the dummy placeholder values this repo
  ships with by default — real credentials go in `server/.env`, never
  committed). That fallback is also the only way to read a test OTP
  locally without a real Twilio account. `tests/helpers/testDb.ts`
  force-clears all three `TWILIO_*` vars for the same reason
  `METALS_API_KEY` is force-cleared — so a developer's real `.env` can't
  make a test file silently behave differently.
  **In production specifically, the fallback logs only the fact that
  delivery failed, never the message content** (`sendText()`'s
  `logFallback()` branches on `env.nodeEnv === "production"`) — a
  pre-launch audit caught that the original fallback printed the raw OTP
  code to server logs on *any* Twilio failure, not just "unconfigured"
  (a transient rate-limit/network/expired-credential error in production
  would have leaked a real user's verification code). Dev/test keep the
  full line since it's still the only way to read a code locally.
- **`authRateLimiter`'s and `otpResendRateLimiter`'s limits are raised (not
  disabled) under `NODE_ENV=test`** (`middleware/rateLimit.ts`, checked
  against `env.nodeEnv`). Vitest sets `NODE_ENV=test` automatically;
  without this, a single test file exercising the OTP wrong-guess/resend
  flow at realistic volume (see `tests/api/auth.test.ts`) would trip the
  production IP throttle purely as a test-infrastructure artifact, since
  the rate limiter's in-memory counter is a module-level singleton shared
  across every dynamically-imported `app` within a test file (and
  possibly across files, if Vitest reuses a worker's module cache). Raising
  rather than disabling the limit means a genuine regression that made a
  route fire far more requests than expected would still eventually surface
  as a test failure.
- **The OTP resend *cooldown* (unlike the rate limiters above) can't be
  overridden by an env-var check at request time, since `config/env.ts`
  computes every value once at first import and a test file's dynamic
  `await import("../../src/app")` caches that for the file's whole
  lifetime** — there's no way to change it mid-file. `testDb.ts`'s
  `setupTestDatabase()` takes an optional `{ otpResendCooldownSeconds }`
  and always explicitly sets `OTP_RESEND_COOLDOWN_SECONDS` (defaulting to
  `0`, never left to whatever a previous test file's run left in
  `process.env`, in case Vitest reuses a worker) — most test files get `0`
  so unrelated resend calls aren't throttled, while
  `tests/api/auth-otp-cooldown.test.ts` (the one file that actually tests
  the cooldown) passes a real, short value and sleeps past it with a real
  `setTimeout`. If you add another env-backed constant that a test needs
  to vary (not just disable), extend `setupTestDatabase()`'s options the
  same way rather than trying to mutate `process.env` after the fact.
- **`Settings.universalOtpCode` is a deliberate, admin-controlled bypass of
  OTP phone verification for every account at once — this is intentional,
  not a vulnerability, but treat it with the same care as any other
  authentication-weakening switch.** When an admin sets it (a 5-digit
  string, `AdminSettings.tsx`'s "Universal OTP code" section, `null`/empty
  by default), `auth.service.ts`'s `verifyOtp()` checks it *before* the
  per-user `OtpCode` lookup: a submitted code matching it exactly verifies
  the calling user's account immediately, consuming whatever individual
  code they had pending, regardless of whose account it is or how many
  wrong attempts they'd already used — genuinely bypassing both individual
  code generation and the (nonexistent, per the earlier invariant)
  expiration check, per its own explicit purpose. It does *not* bypass
  `verifyOtpSchema`'s 5-digit format validation or `authRateLimiter` on
  the route, since those apply before the controller ever calls into
  `auth.service.ts`. Existing-user login/browsing is unaffected either
  way — this only ever short-circuits the *verification* step. Stored in
  plaintext (unlike `OtpCode.codeHash`), deliberately: an admin needs to
  read back and communicate this value, unlike a per-user one-time code
  that's never displayed again after issuance. `settings.service.ts`'s
  `updateSettings()` treats an empty string from the admin form as "clear
  it" and normalizes to `null` — checked with `"universalOtpCode" in
  input`, not truthiness, so a settings update that doesn't touch this
  field (e.g. just the commission) can never accidentally clear an
  existing code as a side effect.
  **Globally brute-force-protected, separately from the per-account
  `OtpCode.attempts` cap** (`Settings.universalOtpFailedAttempts`/
  `universalOtpLockedUntil`) — a pre-launch audit found that a per-account
  cap alone is meaningless here, since an attacker can just register a
  fresh account to reset it, but can't reset a global counter. Every wrong
  code submitted anywhere while a universal code is active (not just
  deliberate guesses at it — there's no way to tell those apart from a
  mistyped real code, and it doesn't matter) increments the global
  counter; hitting `MAX_UNIVERSAL_OTP_FAILED_ATTEMPTS` (10) disables the
  bypass for `UNIVERSAL_OTP_LOCKOUT_MINUTES` (15), falling through to each
  account's own normal per-code flow (still fully functional) rather than
  rejecting the request outright. A correct guess resets the counter,
  since the code is now known regardless of failure history.
- **`Settings.otpVerificationEnabled` is a master on/off switch for the
  registration OTP flow itself, distinct from `universalOtpCode` above
  (which bypasses entering *a* code, but a verify-otp step still has to
  happen).** Defaults `true` (today's OTP-gated flow, unchanged). When an
  admin sets it `false`, `auth.service.ts`'s `registerUser()` skips
  `issueAndSendOtp()` entirely (no SMS sent, no `OtpCode` row created) and
  creates the account already `isVerified: true` - the account never enters
  a pending state at all, so there's nothing left to verify and no reason to
  route the shopper to `/verify-otp`. `Register.tsx` checks the `isVerified`
  the server actually returned (not an assumption) and navigates home
  instead of to `/verify-otp` when it's already `true` - don't hardcode the
  post-registration redirect, since which one is correct depends on this
  setting. This only affects *new* registrations from the moment the toggle
  changes - it does not retroactively verify accounts that were already
  left pending from before, and it has no effect on `verifyOtp()`/
  `resendOtp()` themselves (an already-verified account simply never calls
  either). Surfaced on `AdminSettings.tsx`'s "OTP verification" section as
  a checkbox saved immediately on click (`handleToggleOtpVerification()`) -
  the same immediate-save pattern `metalPriceScheduleEnabled`'s toggle in
  the same page uses (in turn matching `AdminUsers.tsx`'s block/unblock
  quick action), rather than needing its own "Save" button for a single
  checkbox; a confirmation toast fires on success ("OTP verification
  enabled/disabled for new registrations"), and the checkbox reverts if the
  save fails, so it never shows a state the server doesn't actually have.
  No page reload or server restart is needed for the new value to apply -
  `registerUser()` reads `Settings.otpVerificationEnabled` fresh from the
  database on every call, so the very next registration attempt (even one
  already in progress on another tab) sees the change. The
  `universalOtpCode` control sits in the same section, immediately below,
  but is a genuinely separate control with its own explicit "Save universal
  code" button and its own `updateSettings()` call
  (`handleSaveUniversalOtpCode()`) - unlike the toggle, a text input
  shouldn't fire a save on every keystroke, so it keeps the deliberate,
  explicit-submit pattern instead. The toggle is a plain checkbox carrying
  `role="switch"`/`aria-checked` for the right accessible semantics, not
  the sliding-thumb visual `CurrencyToggle` uses elsewhere in this app (see
  the currency-toggle architecture bullet) - a simpler visual treatment was
  fine here since this is an infrequently-touched admin control, not a
  shopper-facing preference.
- **Wishlist and reviews are both upsert-shaped, not create-only.**
  `WishlistItem` (`@@unique([userId, productId])`) and `Review`
  (`@@unique([userId, productId])`) each cap one row per user per product.
  `wishlist.service.ts`'s add/remove are idempotent (adding an
  already-wishlisted product or removing one that isn't there both succeed
  as no-ops, never a 409/404) — mirror this if you add another
  toggle-style relation. `reviews.service.ts`'s `upsertReview()` uses
  Prisma's `upsert` on that same unique constraint, so submitting a second
  review for a product updates the caller's existing one instead of creating
  a duplicate; `getReviews()`'s average is computed via Prisma's `aggregate`
  (`_avg.rating`), not a hand-rolled reduce.
- **Wishlist, cart, and order history are shopping features - not relevant
  to an ADMIN-role account's own use of the app, and hidden/blocked for
  one.** An admin already manages the *store's* products/orders/users from
  `/admin/*`; there's no scenario where they also need to shop under their
  own account. Concretely:
  - **Wishlist**: `wishlist.service.ts`'s `addToWishlist()` takes the
    caller's `role` (from `req.user!.role`, no extra DB fetch - the
    controller already has it from the verified JWT) and throws 403 for
    `"ADMIN"` - enforced server-side, not just a hidden button, since the
    wishlist has a real API surface a client-side-only restriction
    couldn't actually stop. `ProductCard.tsx`/`ProductDetail.tsx` hide the
    heart-toggle button entirely for a signed-in admin (still shown to a
    signed-out visitor and to a customer, unchanged).
  - **Cart**: `cartStore.ts` itself is pure client-side Zustand state with
    no server endpoint of its own, so hiding the "Add to cart" affordances
    (`ProductCard.tsx`'s quick-add button, `ProductDetail.tsx`'s main
    button, quantity stepper, and sticky mobile bar) and the navbar's cart
    icon/link (`Navbar.tsx` - `user?.role !== "ADMIN"`, same condition as
    everywhere else here) is the only enforcement *for the cart itself* -
    with nowhere to add an item, an admin's cart simply always stays
    empty. But placing an order (what a cart is *for*) is a real API
    surface (`POST /orders`), and hiding cart/checkout UI alone couldn't
    have stopped a direct call to it - this was a genuine gap until
    `orders.service.ts`'s `createOrder()` got its own explicit `user.role
    === "ADMIN"` check (403 "Admin accounts can't place orders."),
    mirroring wishlist's server-side check for the identical reason. It
    reads `role` off the same `user` row `createOrder()` already fetches
    for the `isVerified`/`isBlocked` checks right below it - no extra
    query needed, unlike wishlist's role (sourced from the JWT instead,
    since wishlist's service function doesn't otherwise touch the `User`
    table at all).
  - **Order history / wishlist as profile sections**: `Navbar.tsx`'s
    `AccountMenu` and `Profile.tsx`'s own page both hide their "Order
    history"/"Wishlist" links for `user.role === "ADMIN"`.
  - **Route-level blocking**: `/cart`, `/checkout`, `/orders`,
    `/orders/:id`, and `/wishlist` (`App.tsx`) are all gated with
    `<ProtectedRoute excludeRole="ADMIN">` - a signed-in admin navigating
    to any of these directly (not just clicking a now-hidden button/link)
    is redirected to `/` the same way `ProtectedRoute`'s existing `role`
    prop redirects a non-admin away from `/admin/*`. `ProtectedRoute.tsx`'s
    `excludeRole` prop is the inverse of its `role` prop (`role` requires
    an exact match, `excludeRole` requires a mismatch) - use `excludeRole`
    for "everyone except this role", not a second bespoke guard component.
    `/cart` additionally passes `requireAuth={false}`, since unlike
    `/checkout`/`/orders`/`/wishlist` it's browsable while signed out (only
    `excludeRole` applies there - a signed-out visitor is unaffected,
    only a signed-in *admin* is redirected).
  - All of the above (the hidden entry points, the route guards, and the
    server-side order block) check `user.role === "ADMIN"` specifically,
    not `!user` - a signed-out visitor still sees every wishlist/cart
    affordance and can still browse `/cart` exactly as before (clicking
    wishlist/checkout still prompts sign-in); this is only about what a
    *signed-in admin* can reach, never about authentication state in
    general. If you add another shopping-only feature, gate its entry
    points, its route, *and* whatever server endpoint it actually writes
    to (not just the route in front of it) the same way, rather than
    inventing a new pattern or trusting UI-only enforcement for something
    with a real API surface behind it.
- **"Earned" vs "pending" revenue has exactly one definition, shared by the
  dashboard and the dedicated revenue report, not two similar-but-different
  ones.** `orders.schema.ts` exports `EARNED_ORDER_STATUSES` (`CONFIRMED`,
  `SHIPPED`, `DELIVERED` - money actually realized) and
  `PENDING_ORDER_STATUSES` (`PENDING` - not yet realized); `CANCELLED` is in
  neither bucket, since it's void revenue, not deferred revenue.
  `dashboard.service.ts`'s `totalRevenueCents` (the existing single-number
  dashboard stat) and `modules/revenue/revenue.service.ts`'s
  `getRevenueSummary()` (the dedicated `/admin/revenue` page, `GET
  /revenue/summary`, admin-only) both import these constants rather than
  hardcoding the status lists a second time - if "earned" or "pending" ever
  needs to mean something different, change it in one place and both
  surfaces follow.
  `getRevenueSummary()` returns three things, all summed from
  `Order.totalCents`/`OrderItem.lineTotalCents` (always USD cents, per the
  price-snapshotting domain invariant - never recomputed from live prices,
  never converted to LBP server-side): (1) `totalEarnedRevenueCents`/
  `totalPendingRevenueCents`, straight `groupBy`+sum over `Order.totalCents`;
  (2) `revenueByCategory`, a per-`(productType, category)` earned/pending
  split - since `OrderItem` doesn't itself store category, this is a
  `orderItem.findMany` joined through `product: { select: { productType,
  category } } }` and reduced in JS, not a raw SQL join, keeping the
  MySQL-migration path (see "What this project is") clean; (3) `trend`, a
  monthly earned/pending series bucketed by `Order.createdAt` in JS (UTC
  `"YYYY-MM"` keys via `periodKey()`) rather than a DB-specific date-trunc
  function (SQLite's `strftime` has no portable MySQL equivalent) - every
  month in range is pre-seeded into the result map before orders are folded
  in, so a quiet month is a real zero-value point, not a missing one; a
  chart reading gaps as "no data" instead of "$0" would be misleading. By
  default this covers the trailing `months` months (query param, default
  12, max 24, including the current in-progress month) ending "now" - or,
  when the request also supplies `fromDate` **and** `toDate` together
  (`revenueSummaryQuerySchema`'s `.refine()`s require both or neither -
  either alone is a 400, as is `toDate` before `fromDate`, or a range
  spanning more than `MAX_FILTERED_TREND_MONTHS` - 36 - calendar months),
  the trend is scoped to that exact range instead and `months` is ignored
  entirely. **Only the trend is ever scoped by `fromDate`/`toDate`** -
  `totalEarnedRevenueCents`/`totalPendingRevenueCents` and
  `revenueByCategory` stay all-time regardless, since the client's
  date-range filter is specifically a trend-chart control, not a
  store-wide "as of this range" report.
  **The trend's bucket granularity is always whole calendar months, even
  though `fromDate`/`toDate` cut on exact days** - `getRevenueSummary()`
  keeps two separate pairs of bounds: `queryStart`/`queryEnd` (precise to
  the day - `queryEnd` is `toDate + 24h`, inclusive of that whole day, the
  same convention `orders.service.ts`'s `listAllOrders()` uses for its own
  date-range filter) bound which *orders* actually get counted, while
  `bucketStart`/`bucketMonthCount` (both rounded to whole months via
  `startOfMonth()`) bound which *bucket keys* get pre-seeded - every
  calendar month `fromDate` through `toDate` touches at all, even
  partially. A range that starts or ends mid-month therefore still shows a
  real bucket for that month, correctly totalling only the in-range days
  within it, not the whole month's revenue - don't collapse these two
  pairs of bounds back into one; that's exactly the bug that would
  silently over-count a partial edge month. The response also carries
  `filteredRange: { fromDate, toDate } | null` (each `"YYYY-MM-DD"`, via
  `dateKey()`) - the *exact* requested dates (not month-rounded) when a
  `fromDate`/`toDate` filter was applied, `null` for the default
  trailing-window trend - so `AdminRevenue.tsx` can show "Showing:
  `<fromDate>` - `<toDate>`" above the chart without re-deriving whether
  it's currently filtered, or what exact dates to show, from the trend
  array's own shape or its first/last bucket period (which is
  month-rounded and therefore not the literal date the admin typed).
  **`client/src/pages/admin/AdminRevenue.tsx`** (`/admin/revenue`, linked
  from `AdminLayout.tsx`'s sidebar with the existing `TrendingUpIcon`)
  renders two stat tiles (earned/pending totals), the category breakdown as
  a table, and the trend as a **recharts** `LineChart` (two lines, earned
  and pending) inside `ResponsiveContainer` - **recharts is this client's
  only charting dependency**, added specifically for this page since
  nothing chart-like existed before; don't add a second charting library
  for a future chart, reuse this one. `ResponsiveContainer` needs a real
  `ResizeObserver`, which jsdom doesn't provide - `client/src/test/setup.ts`
  installs a no-op stub globally for this reason (harmless for every other
  test file, since nothing else in this client uses it yet). **Each stat
  tile has a "View orders" link drilling straight into the orders behind
  that number** - the Earned tile links to `/admin/orders?status=EARNED`,
  the Pending tile to `/admin/orders?status=PENDING` - reusing
  `AdminOrders.tsx` itself (full filter/sort/edit/delete/etc., not a
  separate read-only view) rather than building a second orders-listing
  page; see that page's own bullet above for how `?status=` seeds its
  filter on load. `AdminRevenue.tsx` itself has no order-level data to
  drill into directly (`getRevenueSummary()` only ever returns aggregates,
  never order ids), so these links exist purely at the routing/filter
  layer - clicking one re-fetches the order list fresh with the right
  filter applied, rather than passing any data forward from this page.
  **The trend chart also has its own date-range filter** - a "From" and a
  "To" `<input type="date">` (the exact same pattern `AdminOrders.tsx`'s
  own date-range filter already uses, down to the `aria-label`s), staged
  in local state and only committed on clicking "Apply" (not on every
  keystroke - the same staged-until-explicit-submit convention
  `AdminCommission.tsx`/`AdminOrders.tsx`'s Save button already use, for
  the identical reason: an in-progress edit shouldn't fire a request on
  its own). "Apply" stays disabled until both fields are filled in, since
  the server rejects either alone anyway; a client-side check also rejects
  (with an inline message, no request sent) a `toDate` before `fromDate`
  before ever hitting the server's own equivalent 400 for that. Applying
  replaces `appliedFilter` (`{fromDate, toDate} | null`, each a plain
  "YYYY-MM-DD" string), which is the sole dependency of the page's own
  `load()` `useCallback` - so applying (or clearing, via the "Clear
  filter" button that appears only once a filter is active) always
  triggers exactly one fresh `fetchRevenueSummary()` call. When
  `summary.filteredRange` comes back non-null, a "Showing: `<fromDate>` -
  `<toDate>`" line renders directly above the chart (`formatDate()`, a
  small `"YYYY-MM-DD"` → `"Mon D, YYYY"` formatter local to this file that
  parses the string directly rather than going through `new
  Date(...)`/`toLocaleDateString()`, which would interpret it in the
  browser's local timezone and could display a day off from what was
  actually applied) - this reads the *server's* echoed `filteredRange`,
  not the client's own staged input state, so the displayed range always
  matches what the chart actually shows even if the admin has since
  changed the inputs without clicking Apply again.
- **Bulk-action routes must be registered before generic `/:id` routes.**
  `PATCH /products/bulk-status`, `POST /products/bulk-delete`, and
  `PATCH /orders/bulk-status` are all mounted in their router *above* the
  `/:id` pattern routes (`products.routes.ts`, `orders.routes.ts`) —
  Express matches routes in registration order, so `/bulk-status` would
  otherwise be swallowed by `/:id` with `id = "bulk-status"`. Keep any new
  bulk-action route above its module's `/:id` routes.
- **Client-side native browser dialogs are replaced by shared contexts,
  everywhere.** `window.confirm()` is not used anywhere in this app —
  `context/ConfirmContext.tsx`'s `useConfirm()` returns a promise-based
  `confirm(message, {title?, confirmLabel?, danger?})` backed by one modal
  instance. Ad hoc per-page save/error feedback (a local `saved`/`error`
  boolean rendered inline) is likewise replaced by
  `context/ToastContext.tsx`'s `useToast().showToast(message, "success" |
  "error")` for transient action feedback — inline errors are still fine for
  persistent, form-adjacent validation messages (e.g. `AdminProductForm.tsx`
  keeps its own `error` state next to the submit button), but a one-off
  "saved"/"deleted"/"couldn't do X" notification should be a toast, not new
  local state. Both providers are mounted once in `main.tsx`, wrapping
  `<App />`; don't add a second confirm/toast mechanism per page.
- **One `Pagination` component for every paginated list.**
  `components/common/Pagination.tsx` takes `{page, pageSize, total,
  onPageChange}` (the exact shape every list endpoint returns per the
  `Paginated<T>` client type) and renders nothing when everything fits on
  one page. `Shop.tsx`, `BullionShop.tsx`, `AdminProducts.tsx`,
  `AdminUsers.tsx`, and `OrderHistory.tsx` all use it — don't hand-roll
  another prev/next control. `GET /orders` (customer path, not the admin
  `?all=true` one) is paginated the same way as products/users
  (`orders.schema.ts`'s `listOrdersQuerySchema`,
  `orders.service.ts`'s `listOrdersForUser()`); `fetchAllOrders()`
  (admin) deliberately stays unpaginated since `AdminOrders.tsx` has no
  pagination UI.
- **`FeaturedCarousel.tsx` (home page) has responsive items-per-slide, not
  a fixed page size.** `hooks/useMediaQuery.ts` (a thin `window.matchMedia`
  wrapper, re-render on the query's own `"change"` event, not a resize
  poll) drives `productsPerSlide`: 1 below Tailwind's `sm` (640px), 2 from
  `sm` to `lg` (640-1023px), 3 at `lg`+ (1024px+). **The chunk size in JS
  and the grid's `sm:`/`lg:` column classes must always match exactly** -
  a pre-launch UX audit found the original version fixed the chunk at 3
  products regardless of viewport while the per-slide grid was
  `grid-cols-1 sm:grid-cols-3`, so on mobile each "slide" stacked all 3
  products vertically in a single-column grid instead of showing one
  product at a time - wildly inconsistent slide heights and a broken feel
  on small screens. If you change one side of that pairing, change the
  other. Resizing across a breakpoint re-paginates immediately and clamps
  the current index back to a valid page if the new page count is smaller
  (`useEffect` keyed on `pageCount`) - don't remove that clamp, or a
  viewport shrink can leave the carousel pointed at a page that no longer
  exists.
  **Autoplay** advances every 5s (`AUTO_ADVANCE_MS`), pauses on
  hover/focus, stops entirely with a single page, and is skipped
  altogether when `useMediaQuery("(prefers-reduced-motion: reduce)")`
  matches - a real user preference, not a nice-to-have. **The slide
  transition** (`transition-transform duration-500 ease-out`) becomes
  instant via Tailwind's `motion-reduce:transition-none` variant for the
  same visitors - this is deliberately a CSS class, not a JS conditional,
  and specifically why the sliding `<div>`'s inline `style` only ever sets
  `transform` and nothing else: an inline style always wins over a class
  regardless of specificity or media queries, so putting
  `transitionProperty`/`transitionDuration` inline would silently defeat
  the `motion-reduce:` override for exactly the visitors it exists for.
  **Accessibility**: the carousel is one `role="region"` with
  `aria-roledescription="carousel"`; each slide is `role="group"` with
  `aria-roledescription="slide"` and a `"Slide X of Y"` label. Every
  non-active slide is `inert` (React 19's native boolean prop - not a
  manual `tabIndex`/`aria-hidden` combination on each descendant), which
  drops its buttons/links out of both the tab order and the accessibility
  tree, so a keyboard or screen-reader user tabbing through the page never
  lands on an off-screen product card. Left/Right arrow keys move to the
  previous/next slide from focus anywhere inside the carousel (event
  bubbling from whatever's focused - the arrows, a dot, or a product
  card's own link/button - up to the region's `onKeyDown`).
  `FeaturedCarousel.test.tsx` covers all of the above (responsive
  chunking, wrap-around navigation, index-clamping on resize, autoplay
  pause/resume, reduced-motion, and the ARIA/`inert` structure) - its
  `mockMatchMedia`/`simulateViewportChange` helpers build a registry-backed
  fake `MediaQueryList` per query rather than a static object, specifically
  so `simulateViewportChange` can fire real `"change"` callbacks and prove
  `useMediaQuery` reacts to them; a static mock would make every
  responsiveness test pass trivially without exercising that path at all.
  Querying an inactive (`aria-hidden`) slide by role+name doesn't work even
  with `{ hidden: true }` - an element's *computed* accessible name is
  empty while `aria-hidden`, by spec, regardless of that option (which only
  stops `getByRole` from excluding it outright) - so the test file's
  `getSlide()` helper matches on the raw `aria-label` *attribute* instead.
- **Other reusable client primitives, don't duplicate them:**
  `hooks/useDebouncedValue.ts` (debounces a fast-changing value - e.g.
  `Shop.tsx`'s search box - so an effect can depend on the debounced
  version instead of firing on every keystroke);
  `components/common/QuantityStepper.tsx` (a +/- quantity control that
  clamps to `[min, max]` on every change, including a typed value - unlike
  a bare `<input type="number">`, whose `min`/`max` are only soft UI hints;
  used on `Cart.tsx` and `ProductDetail.tsx` so both clamp identically -
  this fixed a real bug where `Cart.tsx`'s old raw input let a typed
  quantity exceed stock);
  `components/common/OrderStatusTimeline.tsx` (a visual step progress
  indicator for `OrderStatus`, replacing a static colored pill on
  `OrderHistory.tsx`/`OrderDetail.tsx` - `CANCELLED` renders as its own
  terminal-state row rather than a step, since it's outside the normal
  PENDING→CONFIRMED→SHIPPED→DELIVERED progression);
  `components/common/Skeleton.tsx` (`Skeleton` primitive +
  `ProductGridSkeleton`, shown in place of "Loading..." text on first load
  only - `Shop.tsx`/`BullionShop.tsx`/`Wishlist.tsx`/`Home.tsx` all gate it
  behind a `hasLoaded` flag so filter/page changes don't re-flash it - plus
  `ProductDetailSkeleton`/`OrderListSkeleton`/`OrderDetailSkeleton` for
  `ProductDetail.tsx`/`OrderHistory.tsx`/`OrderDetail.tsx`, which don't need
  the `hasLoaded` guard since each only loads once per id/page, not on
  every filter change, plus `NotificationListSkeleton` for
  `Notifications.tsx`. No customer-facing page should fall back to plain
  "Loading..." text or a blank screen — add a matching skeleton here if you
  build a new one instead);
  `components/common/Breadcrumbs.tsx` (`items: {label, to?}[]`, last item
  has no `to`);
  `components/layout/NotificationToastBridge.tsx` (mounted once in
  `main.tsx`, drains `notificationStore`'s live-arrival queue into
  `useToast()` calls - the socket handler that fills that queue lives
  outside React and can't call a hook directly, hence the bridge). Toasts
  now have a third kind, `"info"` (`ToastContext.tsx`), used only for these
  real-time notification arrivals since they aren't a "success" or a
  failure of anything the viewer just did.
- **Every background data fetch must have a `.catch()` that gives the user
  feedback, not a silent no-op.** An audit of this app found several pages
  (`Home.tsx`, `Shop.tsx`, `BullionShop.tsx`, `OrderHistory.tsx`,
  `Wishlist.tsx`) fetching their primary data with no `.catch()` at all -
  a failed request left the page either stuck on "Loading..." forever or
  silently blank, indistinguishable from a genuine empty result. The fix
  everywhere was the same: `.catch(() => showToast("...", "error"))` (see
  `context/ToastContext.tsx`) plus, where the page has no other content to
  fall back on, a small inline retry affordance. If you add a new
  page-level fetch, give it the same treatment from the start.
  **This regressed broadly across the whole admin panel** (a follow-up,
  pre-launch audit found essentially every `pages/admin/*.tsx` page's data
  load, plus most of their mutation handlers - save/delete/bulk-action
  buttons - missing the same treatment) and was fixed the same way
  everywhere: a `loadError` state + inline "Couldn't load X. Try again."
  banner for page-level loads, `try/catch` + `showToast(..., "error")` for
  mutation handlers. `AdminProductForm.tsx` needed a slightly different
  fix - on a failed *edit* load, the form must not render at all (it would
  otherwise silently show blank "new product" defaults under an "Edit
  product" heading, and submitting would overwrite the real product with
  unrelated values) - see its `hasLoaded`/`loadError` guard. Stores whose
  `load()` is called without `await`/`.catch()` at the call site
  (`notificationStore.ts`, `wishlistStore.ts`, both called from
  `AuthContext.tsx`'s login/register/silent-refresh) catch their own
  errors internally instead, since fixing every call site individually
  isn't possible when the call is deliberately fire-and-forget.
- **`OrderHistory.tsx`'s "Reorder" button re-fetches each item's *live*
  product** (`api/products.ts`'s `fetchProduct`) rather than reusing the
  order's price/name snapshot - re-ordering should reflect today's price
  and stock, not the historical snapshot (that distinction is the whole
  point of domain invariant #1, which still applies to the *original*
  order's own record). It clamps the re-added quantity to current stock and
  skips (with a toast noting how many) any item whose product is now
  inactive or out of stock, via `Promise.allSettled` so one missing product
  doesn't abort the rest.
- **`hooks/useSyncCartWithCatalog.ts` reconciles the *cart itself* against
  the live catalog, for the same underlying reason Reorder above
  re-fetches: `cartStore.ts` persists to localStorage indefinitely with no
  expiry, and a line's `unitPriceCents`/`stockQuantity` are otherwise never
  touched again after add-to-cart time - a shopper who adds an item and
  comes back after the metal price (and therefore the product's price) has
  moved would see a stale total all the way through checkout. This is a
  *display* problem only, not a financial one - `orders.service.ts`'s
  `createOrder()` already always reads the product's current
  `currentPriceCents` at order time and never trusts anything the client
  sends (`createOrderSchema`'s `items` only carry `productId`/`quantity`,
  never a price) - but a shopper discovering a different total only after
  placing the order is still a bad, "bait and switch"-feeling experience
  worth closing on the display side too. The hook re-fetches each cart
  line's product on mount (dependency: the cart's *product id set*, not its
  contents, matching `Cart.tsx`'s pre-existing cross-sell effect - a
  quantity edit alone doesn't re-trigger it) and, for each: removes the
  line if the product is now inactive or fully out of stock (mirroring
  Reorder's same check), otherwise writes back the live price and stock and
  clamps quantity to the (possibly reduced) stock - surfacing a toast for
  whichever of these actually happened. Used by both `Cart.tsx` and
  `Checkout.tsx` independently, since either can be the first page a
  shopper lands on in a visit (a bookmark, the back button) without passing
  through the other first.
  **Reconciliation is applied against the line as re-read fresh at
  apply-time (`useCartStore.getState().lines.find(...)`), never the
  snapshot captured when the fetch started** - a real race this hook's own
  test (`Cart.test.tsx`) catches: if the shopper edits a line's quantity
  while its (possibly slow) reconciliation fetch is still in flight, using
  the stale mount-time quantity to compute `Math.min(quantity, stock)`
  would silently revert their edit back down once the fetch resolves. If
  you touch this hook, keep reading the current line at write time, not the
  one captured when `Promise.all` started - and if a line disappeared
  entirely in the meantime (the shopper removed it manually), skip it
  rather than resurrecting it.
  `cartStore.ts`'s `updateLine(productId, patch)` is the general-purpose
  action this hook writes through - unlike `updateQuantity` (quantity
  only), it can patch price/stock/quantity together in one update, and
  shares the same "drop the line once its quantity hits zero" behavior.
- **Printable pages use Tailwind's `print:hidden` on chrome, not a separate
  print stylesheet.** `OrderDetail.tsx`'s "Print invoice" button
  (`window.print()`, no PDF library added) relies on `Navbar.tsx`,
  `Footer.tsx`, `OverrideBanner.tsx`, and `ToastContext.tsx`'s toast stack
  all carrying `print:hidden`, plus `print:hidden` on the page's own
  back-link/cancel/print buttons - so the printed output is just the order
  content. Give any other page you want to make printable the same
  treatment rather than introducing `@media print` CSS or a print-specific
  route.
- **`ProductCard.tsx` shows an aggregate rating when one exists.**
  `products.service.ts`'s `attachRatings()` helper attaches
  `averageRating`/`reviewCount` to every product returned by
  `listProducts()` and `getRelatedProducts()` via a single `review.groupBy`
  query (never one `review.aggregate()` per product - that would be an
  N+1). `getProduct()` (single-product fetch) intentionally does *not*
  attach ratings, since `ProductDetail.tsx` already computes its own from
  its dedicated reviews fetch. If you render products as `ProductCard`s
  from a new endpoint, route it through `attachRatings()` too rather than
  leaving `averageRating`/`reviewCount` undefined (the card simply omits
  the rating line when `reviewCount` is falsy, so it degrades gracefully,
  but a real rating should be shown when one exists).
- **One top-level `ErrorBoundary` and one `NotFound` page.**
  `components/common/ErrorBoundary.tsx` wraps the whole app in `main.tsx`
  (outside `BrowserRouter`, so it also catches routing-adjacent errors) and
  shows a generic reload prompt — it does not catch errors in event
  handlers/async code, which should surface via a toast at the call site
  instead. `pages/NotFound.tsx` is the `path="*"` catch-all in `App.tsx`'s
  route table (must stay the last `<Route>` in the list).

- **CORS is one explicit origin-allowlist callback, never `origin: true`/`"*"`.**
  `app.ts`'s single `app.use(cors(...))` (mounted before every route, so it
  applies to all of them — don't add a second `cors()` call anywhere else)
  checks the request's `Origin` header against `env.clientOrigins` (parsed
  from a comma-separated `CLIENT_ORIGIN`) and rejects anything not on that
  list. This is required, not just stylistic: the API uses
  `credentials: true` for the refresh-token cookie, and browsers reject a
  wildcard `Access-Control-Allow-Origin` alongside credentials anyway — but
  even if they didn't, reflecting any origin would let any website make
  authenticated requests using a signed-in visitor's cookies. To allow a new
  frontend origin, add it to `CLIENT_ORIGIN`; don't loosen the callback
  itself. `requestPasswordReset()` (`auth.service.ts`) builds its reset link
  from `env.clientOrigins[0]` specifically (not a client-supplied origin —
  that would be an open-redirect risk) when more than one origin is allowed.
- **`User.lastLoginAt` means "last actual login," not "last request."** It's
  set only in `auth.service.ts`'s `loginUser()`, never on registration
  (creating an account isn't logging in again) and never on silent
  refresh-token rotation (same session continuing, not a new login event).
  `null` means the account has never logged in since it was created. If you
  add another auth entry point (e.g. a future SSO flow), set it there too,
  the same way — don't let a new path silently skip it.

## Tests

Backend tests run on [Vitest](https://vitest.dev) (`cd server && npm test`).
**Do not add Jest or any other test runner** — Vitest already exposes the
same `describe`/`it`/`expect` API Jest does, so a second framework would
just be a redundant, conflicting dependency. There are two layers:

- `tests/pricing.test.ts`, `tests/orderSnapshot.test.ts` — pure-function and
  service-level tests for the pricing formula and the price-snapshotting
  invariant (see domain invariant #1 above).
- `tests/api/*.test.ts` — HTTP-level tests via
  [supertest](https://github.com/ladjs/supertest) against the real Express
  `app` export, covering every module's routes including RBAC (401/403) and
  validation (400) cases.

**Isolated per-file databases.** Each test file calls
`setupTestDatabase("<unique-name>.db")` (`tests/helpers/testDb.ts`) in
`beforeAll` to create and migrate its own throwaway SQLite file under
`server/tests/` (gitignored, deleted in `afterAll`) — never point a test at
`server/prisma/dev.db`, and never reuse another file's db name (Vitest can
reuse worker threads across files, so a shared name risks cross-file
contamination). Two consequences of this pattern that matter when adding
tests:

1. **Import app modules dynamically**, after `setupTestDatabase()` has run:
   `const { app } = await import("../../src/app")`. A static `import` at the
   top of the file is hoisted above your `beforeAll` by the ES module spec
   and would load `db/prisma.ts` (and therefore `config/env.ts`) before
   `DATABASE_URL`/JWT secrets are set, pointing it at the wrong database or
   crashing on missing env vars.
2. **`setupTestDatabase` force-clears `METALS_API_KEY`** to `""` for this
   exact reason: `metals.service.ts` only checks whether the var is
   *present*, so if a developer's real `server/.env` (loaded by `dotenv` the
   first time `config/env.ts` is imported) has a placeholder or real key in
   it, tests would silently make a real network call to metals.dev instead
   of exercising the deterministic "not configured" error path. This is a
   real bug this test suite caught once already — if you add a test that
   depends on an env var being unset, clear it explicitly in the test rather
   than assuming a clean environment.

Use `tests/helpers/fixtures.ts`'s `createUserWithToken(prisma, { role })` to
get an authenticated customer/admin without going through the HTTP
register/login flow, when the test isn't specifically about auth.

**Client tests** (`cd client && npm test`) also run on Vitest, plus [React
Testing Library](https://testing-library.com/react) - added in a pre-launch
audit; the client previously had zero test infrastructure. Config lives in
`client/vitest.config.mts`, separate from the dev/build `vite.config.ts`
(its `/api`/`/uploads`/`/socket.io` dev-proxy entries are meaningless once
every network call is mocked). Coverage is deliberately critical-path, not
exhaustive - see `README.md`'s "Client tests" section for which
pages/components are covered and why. Conventions, all established in
`Login.test.tsx`/`Cart.test.tsx`/`AdminDashboard.test.tsx`/`Navbar.test.tsx`
- follow them rather than inventing a new pattern per file:
- **Tests are co-located** (`Component.test.tsx` next to `Component.tsx`),
  not gathered in a separate directory like the server's `tests/` - a
  deliberate difference, not an inconsistency (see the README section for
  why each layer suits a different convention).
- **`src/test/setup.ts` explicitly calls `afterEach(cleanup)`** from
  `@testing-library/react`. This project does *not* set Vitest's `globals:
  true` (tests import `describe`/`it`/`expect` explicitly, matching the
  server suite) - RTL's own auto-cleanup registration only self-activates
  when it detects a global `afterEach`, so without this, DOM from one test
  silently leaks into the next test in the same file (a real bug hit while
  writing the first client test - a later test found an element left over
  from an earlier one's render). Don't remove this from `setup.ts`.
- **Mock hooks/API modules directly with `vi.mock(...)`, don't wrap tests
  in real Context Providers.** E.g. `vi.mock("../context/AuthContext", ()
  => ({ useAuth: vi.fn() }))` then `vi.mocked(useAuth).mockReturnValue(...)`
  per test - this isolates a page/component's own logic from how
  `AuthContext`/`ToastContext`/`ConfirmContext`/the API layer are
  implemented, and avoids needing to also mock `api.post("/auth/refresh")`
  and cookie/token plumbing just to render a page that merely calls
  `useAuth()`. Zustand stores (`cartStore`, `notificationStore`, etc.) are
  the exception - they're plain state containers, not React context, so
  tests use the *real* store and reset the slice they care about via
  `useXStore.setState({ ... })` in `beforeEach`. **Never pass `true` as
  `setState`'s second (`replace`) argument** - that replaces the *entire*
  state object, including the store's action functions, not just the
  fields you listed (a real bug hit here too: `setState({ lines: [...] },
  true)` silently deleted `removeItem`/`updateQuantity`/etc., so calling
  them later threw `TypeError: removeItem is not a function`).
- **Router-dependent components** (anything using `Link`/`NavLink`/
  `useNavigate`/`useLocation`) are wrapped in a real `<MemoryRouter>`
  (`initialEntries` to set the starting path/state), not a router mock -
  for tests asserting a redirect happened, wrap in `<Routes>` with a couple
  of placeholder destination routes (e.g. `<Route path="/admin"
  element={<p>Admin page</p>} />`) and assert the placeholder text appears,
  rather than trying to inspect router internals directly.

## Working in this repo

- **`npm install` must use `--no-audit --no-fund`** (in both setup scripts
  and the README's manual instructions). Diagnosed directly on this machine:
  plain `npm install` hangs indefinitely with zero CPU and zero network
  activity on the actual package-install step, then confirmed via
  `--loglevel silly` that it was already past dependency installation and
  stuck specifically on the bulk vulnerability-advisory POST request
  (`registry.npmjs.org/-/npm/v1/security/advisories/bulk`) — a plain `curl`
  GET to the same host worked instantly, ruling out a general network/proxy
  block. `--no-audit` skips that call entirely; `npm install --no-audit
  --no-fund` on the same machine completed in ~1s. If you add any other
  `npm install` invocation (a new script, CI config, etc.), use the same
  flags — don't reintroduce a plain `npm install`.
- **`setup.sh` and `setup.ps1`** (repo root) are the two canonical one-shot
  dev setups — bash and native PowerShell versions of the same steps:
  install → create `server/.env` if missing → `prisma generate` +
  `migrate deploy` → seed → start both dev servers, with cleanup on Ctrl+C
  (`setup.sh`: `trap` + a process-group kill; `setup.ps1`: `try`/`finally` +
  `taskkill /T /F` to kill the whole cmd→npm→node tree, since npm nests the
  real `tsx`/`vite` process several layers deep and a plain `Stop-Process`
  only kills the top wrapper). **Both must be kept in sync with each other
  and with `README.md`** — if you change any install, migrate, seed, or
  dev-server command (package.json scripts, env var names, etc.), update
  all three.
  - **The API is started first, then polled, then the client** - both
    scripts used to `&`/`Start-Process` the server and client at the same
    time, which let Vite (client, ready in well under a second) come up
    before the API (a few seconds, loading env + connecting Prisma) was
    actually accepting connections. In that window, the browser's
    Socket.IO client fires its connection attempt on page load and hits a
    proxy `ECONNREFUSED` (harmless - it auto-reconnects once the API comes
    up - but confusing to see). Both scripts now poll `GET /api/health`
    (mounted before auth/CORS in `app.ts` - no credentials needed) once a
    second for up to 30s after starting the server, and only start the
    client once it responds 200 - `setup.sh`'s loop also checks `kill -0
    "$SERVER_PID"` and `setup.ps1`'s checks `$serverProc.HasExited` on each
    iteration, so a server that crashed on boot fails fast with a clear
    message instead of the loop running out the full 30s first. If you add
    a third dev process that the others depend on, gate it the same way
    rather than trusting launch order alone.
  - The `setup.ps1` tree-kill was verified directly: inspected the actual
    spawned process tree (`Get-CimInstance Win32_Process`) and confirmed
    `taskkill /PID <root> /T /F` terminates every descendant down to the
    real `tsx`/`node` process, freeing both ports.
  - The `setup.sh` process-group kill is the textbook-correct POSIX fix but
    could **not** be verified against a genuine interactive Ctrl+C from this
    environment — the tool layer's own background-process wrapping made it
    impossible to deliver a real `SIGINT` to the right PID (nested git-bash
    processes don't share a PID/signal namespace cleanly). Don't assume it's
    proven; if you change this script, ask the user to test a real Ctrl+C.
- **Windows dev quirk**: stopping a background `tsx`/`vite` process from the
  tool layer does not reliably kill its child Node process, which then holds
  port 4000/5173 or locks the Prisma query engine DLL on the next
  `prisma generate`/`migrate dev`. If you hit `EADDRINUSE` or `EPERM` on a
  Prisma `.dll.node` rename, kill stray node processes first
  (`Get-Process node | Stop-Process -Force` in PowerShell) before retrying.
  This isn't just a testing-environment artifact — a real user hit this
  exact EPERM running `setup.ps1` normally, so `setup.ps1` now checks
  whether ports 4000/5173 are already listening *before* calling
  `prisma:generate`, and exits with the `Get-Process node | Stop-Process
  -Force` instructions instead of letting the confusing raw EPERM through.
  Verified both ways: with a stale server occupying port 4000, the script
  now stops early with the clear message; after killing it, a full run
  completes with no EPERM. `setup.sh` has no equivalent check — this class
  of file-lock issue is Windows-specific (POSIX allows renaming a file
  that's still open), so the two scripts are expected to diverge here.
- **Prisma client regeneration** requires no server process holding the
  client's query engine file — stop dev servers before `prisma migrate dev`.
- **No browser automation tool is available in this environment.** UI
  changes are verified via `tsc`, `vite build`, and curl/API-level checks —
  say so explicitly rather than claiming a UI was visually verified, and ask
  the user to check the UI themselves when that matters.
- **Don't commit `server/.env`, `server/prisma/dev.db`, or `server/uploads/*`**
  (all gitignored) — they contain secrets, seeded local data, or user-uploaded
  files respectively.
- **The brand name is "Naya Sophia Jewelry"** (`Navbar.tsx`, `Footer.tsx`,
  `client/index.html`'s `<title>`, `README.md`'s heading, the seeded admin
  user's `name` in `seed.ts`, and both setup scripts' header comments). This
  was corrected from a "Sofia" misspelling — if you're reading an older
  commit, screenshot, or cached doc that still says "Naya Sofia", that's
  stale. The project's actual folder name, the root `package.json`'s `name`
  field (`nayasofia`), and the seeded email domain (`@nayasofia.com`) are
  unrelated technical identifiers, not the display brand — they intentionally
  still read "sofia" and don't need to match.
- **Seeded product `imageUrl`s must be verified, not guessed.** Every one is
  a real Unsplash photo CDN URL (`https://images.unsplash.com/photo-<id>`);
  the `<id>` isn't a predictable or incrementable sequence — mutating a
  known-good ID by a few characters to "create" a distinct-looking URL for a
  new product (as happened with several of the bullion products added in an
  earlier pass) produces a 404 that only shows up as a broken `<img>` in the
  browser, not a build or type error. Before adding or changing a seeded
  `imageUrl`, verify it resolves with an actual `curl -o /dev/null -w
  "%{http_code}"` (or equivalent) check — don't hand-edit an existing URL's
  ID. Also note `products.upsert()`'s `update: {}` is intentional (re-seeding
  must not clobber an admin's in-panel edits to an already-seeded product),
  so fixing a bad `imageUrl` that's already been seeded into a live `dev.db`
  requires a direct `PATCH /api/v1/products/:id` (or a fresh DB), not just a
  `seed.ts` edit plus `npm run seed`.
- Only add tests, docs, or abstractions when asked or when they protect a
  correctness-critical invariant (see the domain invariants above) — this
  project intentionally keeps the stack minimal (no repository layer, no
  Redux, no premature `/v2` API).
