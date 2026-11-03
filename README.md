# Naya Sophia Jewelry

Full-stack jewelry e-shop: React (Vite) client, Node/Express API, Prisma/SQLite database
(designed to migrate to MySQL later without an application rewrite).

## Project structure

```
NayaSofia/
├── server/            Express + TypeScript API
│   ├── prisma/        schema.prisma, migrations/, seed.ts
│   ├── src/
│   │   ├── modules/   one folder per domain: auth, users, products, orders,
│   │   │              metals, settings, business, dashboard, payments,
│   │   │              notifications (email adapter + the in-app
│   │   │              notification system), sms, uploads, accountCleanup,
│   │   │              reviews, wishlist
│   │   ├── middleware/  auth (JWT/RBAC), zod validation, error handling
│   │   ├── realtime.ts  Socket.IO setup for live notification delivery
│   │   └── config/, db/, utils/
│   └── tests/         Vitest suite: unit/integration tests + tests/api/*
│       │              (supertest HTTP endpoint tests) + tests/helpers/*
└── client/            React + TypeScript (Vite) storefront + admin UI
    └── src/
        ├── api/       typed fetch wrappers per resource
        ├── context/   AuthContext (in-memory access token), ToastContext,
        │              ConfirmContext (replace native alert/confirm dialogs)
        ├── store/     Zustand: cart, wishlist, display-currency, and
        │              notification (unread count + live socket) stores
        │              (cart persisted to localStorage; currency preference
        │              persisted to a cookie via lib/cookieStorage.ts;
        │              wishlist/notifications server-backed)
        ├── pages/      storefront pages + pages/admin
        ├── components/ layout, product, metals (live price display), home,
        │               icons, and common (Pagination, StarRating,
        │               ErrorBoundary) components
        └── test/       Vitest + React Testing Library setup (client-side
                        tests are co-located as Component.test.tsx, not kept
                        in this folder - see "Client tests" below)
```

## Features

- **Storefront**: browse/filter/sort products (including a price-range
  filter, filter chips with a "Clear all", a result count, and a
  collapsible filter drawer on mobile), product detail page with related
  products, customer reviews (star rating + comment, one per customer per
  product, also surfaced as a rating on every product card), a wishlist
  (heart-toggle on any product card, `/wishlist`, with a bulk "Add all to
  cart"), cart (with a cross-sell section and a confirm-before-remove
  prompt), and checkout (order saved as `PENDING`, payment deferred). Both
  the cart and checkout page re-validate every line's price and stock
  against the live catalog on load (`hooks/useSyncCartWithCatalog.ts`) -
  gold/silver prices (and therefore product prices) can move while an item
  sits untouched in a cart, so a stale price is updated silently with a
  toast, an item that's since sold out or been delisted is removed, and a
  quantity above the current stock is clamped down - rather than a shopper
  only discovering a different total after placing the order.
  Account management (`/profile`: edit details, change password, sign
  out), a paginated order history (`/orders`, with self-service
  cancellation while an order is still `PENDING`/`CONFIRMED`, a "Reorder"
  button that re-adds an order's items at today's price/stock, and a
  visual status timeline instead of a plain status label), and a per-order
  detail page (`/orders/:id`, with a "Print invoice" button) are separate
  pages, reachable from a dropdown under the signed-in user's name in the
  navbar. None of this — wishlist, cart, or order history — applies to an
  admin's own account: they're shopping features, not relevant to how an
  admin uses the app, so the corresponding buttons/links (including the
  navbar's cart icon itself) are hidden for a signed-in admin, and the
  `/cart`, `/checkout`, `/wishlist`, `/orders`, and `/orders/:id` routes
  themselves redirect a signed-in admin away if visited directly. Both
  adding to a wishlist and placing an order are enforced server-side too
  (403 for an ADMIN-role account), not just hidden client-side, since both
  are real API endpoints a UI-only restriction couldn't actually stop.
- **Featured products carousel** (home page hero section,
  `client/src/components/home/FeaturedCarousel.tsx`): paginated,
  auto-advancing every 5 seconds, with manual prev/next arrows and one dot
  per page (not per product). **Items per slide is responsive**: 1 on
  mobile (below 640px), 2 from 640-1023px, 3 at 1024px and above - tracked
  live via a `useMediaQuery` hook, so resizing the window or rotating a
  device re-paginates immediately rather than leaving items awkwardly
  stacked or cropped. Auto-advance pauses on hover/focus, stops entirely
  with a single page, and is skipped altogether for a visitor with the OS
  "reduce motion" preference set (the slide transition itself also becomes
  instant for them, via Tailwind's `motion-reduce:` variant rather than a
  JS branch). Accessible as a single WAI-ARIA carousel region with
  labeled, per-slide groups; the inactive slide(s) are marked `inert`
  (React 19's native prop) so their buttons/links drop out of the tab
  order and accessibility tree instead of just being visually hidden; and
  Left/Right arrow keys navigate whenever focus is anywhere inside the
  carousel. See `CLAUDE.md` for the full behavior breakdown.
- **Login sessions persist across browser restarts, server restarts, and
  days of inactivity** — signing in sets an HttpOnly, `SameSite=Lax`
  refresh-token cookie (30 days by default, `JWT_REFRESH_TTL_DAYS`) that
  the browser keeps and sends automatically; the short-lived (15 minute)
  access token it's exchanged for lives only in memory and is silently
  re-issued from that cookie on page load and on any request that gets a
  401, with no re-login prompt. Since the cookie lives in the browser (not
  the server process) and the token it represents is checked against the
  database, restarting the dev server doesn't invalidate an existing
  session, and neither does leaving a tab open and idle for a while, as
  long as the cookie itself hasn't expired. Concurrent refresh attempts
  (React's StrictMode double-invoking effects in dev is one real trigger;
  two tabs refreshing at the same moment is another) are handled without
  logging the account out - see `CLAUDE.md`'s "Refresh-token reuse" bullet
  for the full mechanism and the bug it fixes.
- **Forgot/reset password**: `/forgot-password` emails a one-time reset
  link (console-logged in dev — see Notes) that never reveals whether an
  address is registered; using it via `/reset-password?token=...` also
  signs the user out of every other active session, since a password reset
  is exactly the moment an account may have been compromised. This flow has
  no OTP/SMS step of its own - that's a separate, registration-only flow
  (below).
- **Registration requires a phone number (email is optional) and verifies
  it with a 5-digit SMS OTP** sent via Twilio (console-logged as a fallback
  in dev — see Notes). A new account starts unverified: it can sign in and
  browse normally, but can't place an order until it completes
  `/verify-otp` (reachable again later from the account dropdown or from a
  prompt on the checkout page). The code itself never expires (a shopper
  can verify whenever they get around to it), but wrong guesses are
  capped, and requesting a new code invalidates the previous one, is
  rate-limited, and enforces a cooldown (`OTP_RESEND_COOLDOWN_SECONDS`,
  default 60s) between successive requests so resending can't be spammed.
  Since email is optional, logging in accepts either an email address or a
  phone number in the same field. An admin can also set a universal
  override code (Admin → Settings) that verifies *any* account, bypassing
  its individual code entirely — meant for local testing or customer
  support when SMS delivery isn't practical; disabled (blank) by default,
  and should stay that way otherwise, since it weakens phone verification
  for every account while it's set. An admin can also turn OTP verification
  off entirely (Admin → Settings → "OTP verification") — the toggle saves
  immediately on click (with a confirmation toast), no page reload or
  server restart needed, and applies to the very next registration
  attempt. While off, every new registration skips the texted code
  altogether and is created already verified, so it can place an order
  immediately with no `/verify-otp` step at all; turning it back on only
  affects registrations from that point on.
- **USD/LBP currency toggle (display only)**: a toggle switch in the navbar
  lets a shopper flip every customer-facing price display — product
  listings, product detail, cart, checkout, and order history/detail —
  between US Dollars and Lebanese Pounds, converted at render time using an
  admin-set exchange rate (Admin → Settings). The preference is saved in a
  cookie so it's remembered the next time the shopper visits, independent
  of which page they land on first. Nothing is ever stored, charged, or
  snapshotted in LBP — every order, product price, and commission stays in
  USD cents internally; see the "LBP is a display-only currency conversion"
  invariant in `CLAUDE.md`. Admin screens always show USD.
- **Two catalogs, one product model**: alongside the jewelry shop (`/shop`),
  a **Gold & Silver** page (`/bullion`, linked in the navbar right after Home,
  and via a CTA button on the landing page above "Shop the collection") lists
  bullion bars and coins — filterable by metal type, category (bar/coin), and
  weight, and sortable by price or weight, in addition to live metal prices.
  Bullion products go through the exact same cart, checkout, and
  price-snapshotting path as jewelry — they're just a different
  `category`/`productType` on the same `Product` row. Pricing does differ
  in one way: a **making charge** (a flat, per-product labor/fabrication
  cost) only applies to jewelry — bullion is priced purely from metal value
  plus commission, since a bar or coin is bought for its raw metal content,
  not crafted. The admin product form hides the "Making charge" field
  entirely for bullion products so there's nothing to set that wouldn't
  actually affect the price.
- **Change password with current-password verification**: from `/profile`,
  a customer can set a new password by first confirming their current one
  (`PATCH /api/v1/users/:id` with `currentPassword` + `password`); an admin
  resetting another user's password from the admin panel isn't asked for it.
- **Live metal prices and commission, visible everywhere pricing matters**:
  the current gold/silver price per troy ounce (the conventional unit for
  quoting them, converted client-side from the per-gram value the API
  returns), the store's current sell/buy commission for that same metal
  (also quoted per troy ounce, shown inline on that metal's own row), and
  when prices were last fetched are shown on the landing page (large "hero"
  card), the shop listing and each product's detail page (compact strip),
  and the admin dashboard and settings page — all rendered by one shared
  `client/src/components/metals/MetalPricesPanel.tsx` component backed by
  the public `GET /api/v1/metals/latest` endpoint, so there's a single
  source of truth for how this is fetched and formatted.
  Commission is a flat, fixed dollar amount per troy ounce added to (or, if
  negative, subtracted from) the spot metal price — not a percentage, and
  not per gram — and **gold and silver each have their own independent
  selling and buying rate** (four values total: gold-selling, gold-buying,
  silver-selling, silver-buying), rather than one rate applied to both
  metals. It's still only editable by an admin, from Admin → Commission.
- **Metal price locked in at purchase time, visible on the order**: every
  order line item permanently records the gold/silver price and the
  (metal-appropriate — gold or silver, whichever that product is) commission
  that were in effect the moment it was purchased (see the
  price-snapshotting invariant in `CLAUDE.md`). The customer-facing order
  detail page (`client/src/pages/OrderDetail.tsx`, linked from order
  history) and the admin orders list both show this per-item — the metal
  price converted to per-troy-ounce for display, the commission shown as-is
  since it's already quoted per troy ounce — so it stays a truthful
  historical record even after live prices or commission change.
- **Admin interface**: product/order/user CRUD (with pagination, search,
  and sorting on the products and users lists), bulk actions
  (activate/deactivate/delete several products, or change the status of
  several orders, at once), metal price management (a manual "refresh now"
  that always fetches immediately, bypassing any wait — a toggle to turn
  the automatic scheduled refresh on or off — turning it off only stops the
  automatic fetches, never the manual button — and a "Refresh frequency
  (minutes)" input, 1-1440, that's both how often the automatic refresh
  runs and the minimum gap enforced *between automatic refreshes*
  specifically (not the manual button, which is never throttled); changing
  it takes effect within a minute, no restart needed), and a dashboard with
  a low-stock alert
  list alongside the headline stats. A dedicated **Commission** page
  (`/admin/commission`) holds the selling/buying surcharge per troy ounce
  for **gold and silver separately** — two side-by-side sections, each with
  its own selling and buying input, all four validated to a sane ±$5,000
  range and saved together with one button. The
  rest of Settings is split into its own sections, each with its own Save
  button (the schedule toggle above, and the OTP-requirement toggle below,
  both save immediately on click instead): **Store settings** (currency
  exchange rate, low-stock threshold), and **OTP verification** — the
  store-wide on/off switch (saved immediately, with a confirmation toast,
  and live for the very next registration attempt with no reload or
  restart) plus the universal bypass code (a separate control with its own
  "Save universal code" button, described above). A dedicated **Revenue** page (`/admin/revenue`) breaks
  down total revenue into "earned" (confirmed/shipped/delivered orders) and
  "pending" (orders still awaiting confirmation) — a stat tile for each,
  each with a "View orders" link straight through to the admin orders list
  pre-filtered to exactly those orders (the full page, with every existing
  action still available — edit, resend invoice, print, delete — not a
  separate stripped-down view), a chart of the earned/pending trend over
  the trailing 12 months, and a table breaking both down by product
  category. **The trend chart can be filtered to an exact date range**: a
  "From" date and a "To" date (the same date-picker inputs the orders
  list's own date-range filter uses), and an "Apply" button (typing into
  either field alone doesn't refetch anything until Apply is clicked, and
  Apply itself stays disabled until both are filled in) - once applied,
  the chart shows only that range, a "Showing: `<From date>` -
  `<To date>`" line appears above it for clarity, and a "Clear filter"
  button appears to go back to the default trailing-12-months view. The
  chart's granularity stays monthly even when filtered - picking a range
  that starts or ends partway through a month still shows a bucket for
  that month, correctly counting only the days actually inside the range,
  not the whole month. An end date before the start date is rejected
  before anything is even sent to the server. Only the chart is affected -
  the earned/pending stat tiles and the category table above always stay
  all-time regardless of the filter. The products list is split
  into All/Jewelry/Bullion
  tabs with category/metal/price-range filters, mirroring the storefront's
  own filtering. The users list can search by name/email and filter by
  role, and an admin can create a new user directly (defaulting to the
  `CUSTOMER` role, a name-derived placeholder email, and a shared temporary
  password when those are left blank — there's no email/SMS delivery in
  this app, so the admin passes the credentials to the new user themselves).
  Each user also has a private admin-only note (visible only to an admin,
  never to the customer themselves) for support context like delivery
  preferences. **The users table itself is read-only text** — name, email,
  role, verification/blocked status, last login, and the admin note (shown
  truncated, with the full text on hover) are all plain cells, not
  `<select>`/`<textarea>` editors in the row; only a Block/Unblock button
  and Delete remain as inline controls. Editing role, the note, or any
  other profile field always means opening the detail page below. Clicking a user (from the list, or from the
  customer name on any order in the orders list below) opens a dedicated
  management page (`/admin/users/:id`) that leads with a stats sub-header
  of seven cards: **total spending** (earned vs. still-pending, split the
  same "earned/pending" way as the Revenue page below, with a "Send payment
  reminder" button that appears only when there's a pending amount - it
  fires a real in-app notification to the customer, not an email or SMS,
  and the server double-checks there's actually something pending before
  sending it), **registration
  date**, **last login**, **last order** (with a button through to a
  separate order-history page, `/admin/users/:id/orders`), **account
  status** (Active/Blocked, with the block/unblock control right there),
  **OTP verification** (Verified/Not verified, with its own immediate-save
  dropdown - a manual override an admin can flip either direction,
  independent of the registration OTP flow itself - marking an account
  verified immediately lets it place orders, marking it unverified blocks
  that again), and **user role** (an immediate-save dropdown, no
  confirmation needed - offering only `CUSTOMER`/`ADMIN`, see below).
  Below that sits a plain profile-edit form (name, email, phone, address,
  admin notes) and delete - the list page keeps its own quicker inline
  role/notes/block/delete actions alongside all of this for one-off edits.
  **There's a third role, Super Admin, that's never assignable through
  either role dropdown** - it starts with every regular admin permission,
  plus one more: only the super admin can manage another admin account
  (view, edit, block, change role, or delete) - a plain admin can still
  fully manage every customer account and their own, just not a different
  admin's or the super admin's. The seeded admin account (`npm run seed`)
  is the super admin from the start; there's no in-app way to create a
  second one, by design - at most one super admin can ever exist. On the
  users list, a row a plain admin can't manage shows its name as plain
  text (not a link) and "Restricted" in place of the Block/Delete buttons,
  with a tooltip explaining why; the same restriction is enforced on the
  server too, not just hidden in the UI. Opening another admin's detail
  page directly (not through the list) fails the same way for a plain
  admin; the super admin's own detail page shows its role as a fixed
  "Super Admin (fixed)" label rather than an editable dropdown.
  Blocking an account only stops it from placing new orders - it can still
  sign in, browse, and manage its own profile - and deleting an account
  always succeeds now regardless of order history: its orders are detached
  (not deleted) so the sale record is preserved, just no longer tied to a
  customer account. Each order in the admin orders list lets an admin stage
  a status, payment method ("Whish Money" or "Cash on Delivery" - recorded
  manually since payment is still collected out-of-band, see Notes below),
  and payment currency (USD or LBP - what the customer actually paid in,
  independent of the storefront's display-only currency toggle) and commit
  all three together with a "Save" button, rather than saving on every
  dropdown change. **The payment method and currency dropdowns are only
  editable in the exact moment an order is being confirmed** - stage the
  Status dropdown to "Confirmed" on a not-yet-confirmed order and they
  unlock so payment info can be set alongside it; every other time,
  including while an order simply sits at Pending untouched, they're
  disabled, since payment info can only ever be recorded at the moment of
  confirming, and once it's actually saved as confirmed it becomes a
  settled historical fact that can't be changed later; this is enforced on
  the server too, not just by disabling the dropdowns - and now also carries a "Resend invoice" button (sends
  the customer a fresh in-app notification linking back to their order -
  not a real email, since they can already view/print it themselves any
  time) and a "Print invoice" button that opens a minimal, chrome-free,
  print-ready invoice page for that one order in a new tab. Orders can also
  be **permanently deleted** - a "Delete" button per row, a "Delete
  selected" bulk action next to the existing bulk status-change, and a
  "Delete all orders" button that wipes every order in the system - each
  confirmed via the same danger-styled confirmation dialog used elsewhere
  in the admin panel, with "Delete all orders" spelling out exactly how
  many orders are about to be destroyed. This is a deliberate exception to
  how the rest of the app treats orders: everywhere else (cancelling, or
  deleting the account that placed one) the order record survives to
  preserve the financial/audit trail, but this is a genuine, irreversible
  hard delete with no undo and no filter - a deleted order also disappears
  from the Revenue page's historical totals. The order list can also be
  **searched, filtered, and sorted**, the same way the products and users
  lists already are: a search box (matches the order number, or the
  customer's name/email), a status dropdown (the five real statuses, plus
  an "Earned (Confirmed/Shipped/Delivered)" option matching the same
  revenue bucket the Revenue page uses - this is also what its "View
  orders" links pre-select), a "From"/"To" date-range filter on when the
  order was placed, and a sort control (newest/oldest first, or by
  status/customer name, A-Z or Z-A) - all applied server-side and
  combinable with each other. An admin's own account has no
  wishlist, cart, or order-history section - those are
  storefront/shopping features, not relevant to an admin managing the store
  - and the underlying routes are blocked for a signed-in admin, not just
  unlinked, so they can't be reached by URL either.
- **In-app notifications, delivered in real time, with per-category
  preferences for everyone**: a bell icon in the navbar (with an
  unread-count badge) links to a full notifications page, and every event
  also shows up as a live toast via a Socket.IO connection authenticated
  the same way every API request is. Every user - customer or admin - can
  enable/disable each of their own notification categories from that page
  (customers: order updates, account activity, promotions, account
  deletion warnings, wishlist availability); a disabled category is
  suppressed entirely, not just hidden. Customers get in-app delivery
  only, no email or SMS for any of these (password-reset email and the
  registration OTP SMS are unrelated, unaffected security mechanisms, not
  part of this system). Admins additionally get sign-up, low-stock,
  critical-error, and new-order alerts, with their own per-event channel
  preference and a master "enable email/SMS messaging" switch (Admin →
  Notifications), plus a lightweight broadcast tool to message one customer
  or all of them. There's no support-ticket feature in this app, so
  "high-priority support tickets" was deliberately left out of the event
  list rather than added with nothing to trigger it. See
  `server/src/modules/notifications/`.
- **Unverified accounts are warned, then automatically deleted**: an
  account that registers but never completes phone OTP verification is
  removed after `UNVERIFIED_ACCOUNT_TTL_DAYS` (default 14) by a daily
  background job, with a one-time **in-app notification** (not SMS/email -
  see the notification system above) sent
  `UNVERIFIED_ACCOUNT_WARNING_DAYS_BEFORE_DELETION` (default 3) days before
  that so nobody is deleted without notice. Verifying at any point takes an
  account out of scope permanently. Known tradeoff: an account that never
  reopens the app won't see this warning before it's deleted - accepted as
  the cost of keeping regular users' notifications in-app-only. See
  `server/src/modules/accountCleanup/`.
- **Login activity**: every account tracks `lastLoginAt`, set only by an
  actual password login (not registration, not a silent token refresh) and
  shown on Admin → Users alongside each account's verification status.
- **Business info** (Admin → Business info): the storefront's contact
  address/phone, a per-day weekly hours schedule (each day independently
  enabled/disabled with its own open/close time, saved all seven together),
  and dated holiday exceptions (add/remove a specific date's special hours
  or full closure) - all shown in the footer of every page. A holiday
  exception whose date is *today* also shows a warning banner across every
  page automatically, not just in the footer, so a visitor arriving that
  day sees it immediately. A separate, manually-toggled "emergency /
  special-event override" shows that same banner for an unplanned closure
  with no pre-set date (e.g. "closed today, back tomorrow") until an admin
  turns it off again by hand.

## Prerequisites

- Node.js 20+ (developed/tested on Node 24) and npm 10+
- A free [metals.dev](https://metals.dev) API key if you want live gold/silver
  prices (the app works without one — see Notes below)

## Quick start

One script does everything below: installs dependencies, creates
`server/.env` if missing, migrates + seeds the database, and starts both dev
servers. Two equivalent versions are provided — pick whichever matches your
shell:

```bash
./setup.sh          # macOS/Linux, or Windows via Git Bash — bash setup.sh also works
```

```powershell
.\setup.ps1          # Windows PowerShell (native, no Git Bash needed)
```

If Windows blocks the `.ps1` with "running scripts is disabled on this
system", run it as `powershell -ExecutionPolicy Bypass -File .\setup.ps1`
instead of changing your global execution policy.

It's idempotent — safe to re-run any time (e.g. after pulling new
migrations) — and press **Ctrl+C** to stop both servers. The API is started
first, and the script polls `GET /api/health` until it responds before
starting the client — starting both at once let the client's Vite dev
server (which boots almost instantly) come up before the API was actually
accepting connections, so the browser's first Socket.IO connection attempt
could hit a proxy `ECONNREFUSED` in that brief window. See "Setup" and
"Running the app" below if you'd rather run the steps individually, e.g. to
seed without starting servers, or to run each server in its own terminal
(in which case that startup-order race doesn't apply the same way, since
you control when each one starts).

## Setup

```bash
npm install --no-audit --no-fund
cp server/.env.example server/.env
```

> `--no-audit` matters here, not just cosmetic: on some networks, plain
> `npm install` hangs indefinitely on the post-install vulnerability-audit
> network call (npm connects fine, the request just never completes). If
> you hit that, Ctrl+C and re-run with `--no-audit`. Run `npm audit`
> separately, on its own, whenever you want a security check.

Edit `server/.env` and set at minimum:

| Variable | Purpose |
|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | any long random strings, used to sign JWTs |
| `METALS_API_KEY` | your metals.dev key (optional at first — see Notes) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | your Twilio credentials for sending the registration OTP by SMS (optional at first — see Notes) |
| `CLIENT_ORIGIN` | one origin, or a comma-separated list, allowed to call the API with credentials (CORS) |

See `server/.env.example` for every variable (ports, seed account overrides,
etc.) with inline explanations.

Then create the database and load sample data:

```bash
npm run --workspace server prisma:migrate   # creates server/prisma/dev.db and applies migrations
npm run seed                                # admin + customer users, settings, business info/hours, 14 sample products (8 jewelry + 6 bullion)
```

> `prisma:migrate` here runs `prisma migrate dev` - interactive-friendly,
> intended for a developer's own first manual run. `setup.sh`/`setup.ps1`
> instead run `prisma generate` + `prisma migrate deploy` (non-interactive,
> applies existing migrations without prompting to create new ones) - the
> right command for a scripted setup or a real deployment. Use `migrate
> deploy`, not `migrate dev`, in any non-interactive/production context.

## Running the app

Two dev servers run side by side:

```bash
npm run dev:server   # Express API on http://localhost:4000
npm run dev:client   # Vite dev server on http://localhost:5173
```

Open **http://localhost:5173** — the Vite dev server proxies `/api/*` and
`/uploads/*` to the API, so the client never needs to know the API's port.

### Seeded accounts

- Super Admin: `admin@nayasofia.com` / `Admin1234!` (the one and only super admin account - see "Admin interface" above for what that role can do that a regular admin can't)
- Customer: `customer@nayasofia.com` / `Customer123!`

Override these before seeding via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` /
`SEED_USER_EMAIL` / `SEED_USER_PASSWORD` in `server/.env`.

### Re-seeding

The seed script is idempotent (`upsert`), so re-running it is safe:

```bash
npm run seed
```

To start completely fresh, delete the database and re-migrate:

```bash
rm server/prisma/dev.db server/prisma/dev.db-journal
npm run --workspace server prisma:migrate
npm run seed
```

## Deployment

This app has no deployment platform baked in - the notes below cover what a
production run needs regardless of where it's hosted.

- **Generate real secrets.** `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` must
  each be a long random value (e.g. `openssl rand -hex 32`), never the
  `change-me-*` placeholders from `.env.example`. `config/env.ts` refuses
  to start in production with a placeholder or a secret under 32
  characters - this is a hard failure, by design, since a known secret
  lets anyone forge an admin-role access token.
- **Set `NODE_ENV=production`.** This gates the secret check above, makes
  the refresh-token cookie `Secure`, and stops the SMS fallback from
  logging a real OTP code to the console on a Twilio failure (it still
  falls back safely, just without printing the code). Also rotate
  `METALS_API_KEY`/`TWILIO_*` to real, non-placeholder credentials as
  needed - see `.env.example`.
- **Build and run, don't use the dev servers.** `npm run build:server`
  (`tsc` → `server/dist/`) then `npm run start:server`
  (`node server/dist/index.js`) for the API; `npm run build:client`
  (`vite build` → `client/dist/`) for the client, served as static files
  (by a CDN or reverse proxy - this repo doesn't wire up static-file
  serving for the client build itself, only for `/uploads`).
- **Migrate with `prisma migrate deploy`, not `migrate dev`** - see the
  note in Setup above.
- **TLS/HTTPS is expected to terminate in front of this app** (a reverse
  proxy or load balancer), not inside the Express process itself - there's
  no HTTPS-redirect logic here. If that proxy is what actually terminates
  TLS, also set `app.set("trust proxy", <hop count>)` in `server/src/app.ts`
  so `req.secure` and the rate limiters' IP detection see the real
  client connection instead of the proxy's - only enable this when a
  trusted proxy genuinely sits in front, since blindly trusting
  `X-Forwarded-*` headers with no proxy present would let a client spoof
  its own IP and bypass IP-based rate limiting.
- **Don't deploy `server/.env` as committed/shared config.** It holds real
  secrets and must stay out of version control (already gitignored) -
  inject production values via your host's own secrets mechanism instead.

## Tests

The backend test suite runs on [Vitest](https://vitest.dev), which has the
same `describe`/`it`/`expect` API as Jest — there's deliberately no second
test runner in this project.

```bash
cd server
npm test               # run everything once
npx vitest             # watch mode while developing
npx vitest run tests/api/orders.test.ts   # a single file
```

`server/tests/` has two kinds of coverage:

- **`tests/pricing.test.ts`, `tests/orderSnapshot.test.ts`** — unit/integration
  tests for the pricing formula and the order price-snapshotting invariant
  (an order's line-item prices must never change after the fact, even when
  commission or metal prices change later). **`tests/metalsScheduler.test.ts`**
  covers the metal-price schedule toggle and tick behavior at the scheduler
  level (mocking `node-cron` to capture and directly invoke the registered
  callback, since there's nothing HTTP-level to hit here) — both the
  boot-time check and the once-a-minute tick skip calling
  `refreshMetalPrices()` when `Settings.metalPriceScheduleEnabled` is
  `false`, and a "not due yet" 429 is swallowed silently while a genuine
  failure is still logged as an error. `tests/api/metals.test.ts` covers
  the admin-editable `Settings.metalPriceRefreshFrequencyMinutes` two ways:
  `POST /metals/refresh` (the "refresh now" button) always bypasses it
  (`force: true`, even moments after a previous fetch), while calling
  `refreshMetalPrices()` directly without `force` - the scheduler's own
  call shape - still respects it, and reacts to a lowered value
  immediately, with no restart.
- **`tests/api/*.test.ts`** — HTTP-level endpoint tests (via
  [supertest](https://github.com/ladjs/supertest) against the real Express
  `app`) covering auth (register/login/refresh/logout, token rotation, the
  OTP resend cooldown, the universal-OTP-code global lockout, refresh-token
  reuse detection, and - a dedicated test firing two real concurrent
  refresh requests for the same token - that a benign race between them
  never revokes the winner's own new session or an unrelated second
  session, unlike genuine sequential reuse), products (including the low-stock/back-in-stock
  notification crossing logic, the `includeInactive` admin gate, and that a
  GOLD product is priced with the gold commission while a SILVER product is
  priced with the silver commission, at create time), orders
  (including the new-order admin alert, that an ADMIN-role account is
  blocked from placing one at all - 403, with stock left untouched, that a
  SUPER_ADMIN account is blocked from placing one too while still being
  able to list every order via `?all=true`, and
  that an order containing both a gold and a silver item snapshots each
  item's commission from its own product's metal type, not one shared
  rate, that resending an order's invoice creates a fresh in-app
  `ORDER_CONFIRMED` notification rather than a real email, 403s for a
  non-admin, 404s for a missing order, and 409s for an orphaned one,
  that `paymentMethod`/`paymentCurrency` are rejected (400) when sent
  without also confirming the order in that same request - even while it's
  still PENDING - succeed when sent together with `status: "CONFIRMED"`,
  are rejected again on a further attempt once the order is already
  confirmed (with the rejected attempt leaving the stored value
  untouched), that a plain status change with no payment fields in the
  request is never blocked by that rule, and that re-sending the
  already-saved payment method/currency unchanged alongside a status
  change still succeeds regardless, and
  permanently deleting orders - single (cascading to its line items and
  leaving stock untouched, 403 for a non-admin, 404 for a missing order),
  bulk-selected (leaving unrelated orders untouched), and all-at-once via
  `DELETE /orders/all` (reporting back exactly how many were removed), and
  the admin order list's search/filter/sort (`GET /orders?all=true`) -
  searching by customer name/email, filtering by exact status, filtering
  by the "EARNED" pseudo-status (matching every CONFIRMED/SHIPPED/DELIVERED
  order at once - what the Revenue page's "View orders" link on its Earned
  tile uses), filtering by a creation-date range (including that the end
  date is inclusive of its whole day), and sorting by date/status/customer
  name, confirming a non-admin's own `?all=true` request is silently
  ignored rather than honoring any of these params), users (including block/unblock's
  effect on order placement, admin profile edits with the email-conflict
  check, deleting a user with existing orders detaching rather than
  crashing, the per-user order-activity summary's earned/pending split
  across CONFIRMED/PENDING/CANCELLED orders plus its most-recent-order
  field, an admin manually overriding a user's OTP-verification status in
  either direction - proven by placing a real order before and after the
  flip, not just checking the flag - and that field being silently stripped
  from a non-admin's own profile update alongside `isBlocked`/`email`, and
  that sending a payment reminder is admin-only (403 otherwise), 400s when
  the user has no pending order at all - including when their only order
  is CONFIRMED rather than PENDING, 404s for a missing user, and otherwise
  creates a `PAYMENT_REMINDER` notification with the correct pending
  amount in its message once a PENDING order actually exists, that a
  SUPER_ADMIN passes every admin-gated route a plain ADMIN can (the
  `authorize()` role hierarchy), that `"SUPER_ADMIN"` is rejected as a
  `role` value on both create and update (400) while still being a valid
  `role` *filter* value on the list endpoint, and that only the super
  admin can view/edit/delete a different admin or the super admin account
  - 403 for a plain admin on all three, while that same plain admin can
  still fully manage a customer and their own account, and the super
  admin can manage the other admin without restriction),
  settings (including that changing only the silver commission
  reprices silver products but leaves gold products' prices untouched, and
  vice versa), metals (the public `/metals/latest` endpoint's four
  gold/silver selling/buying commission fields),
  dashboard, revenue (earned-vs-pending totals and the category breakdown,
  the monthly trend bucketing with no gaps for quiet months, and that a
  `fromDate`+`toDate` pair scopes the trend to that exact range - a range
  fully inside one month, a range spanning several months (oldest bucket
  first), a range starting mid-month correctly excluding an order from
  just before it while still showing a real bucket for that month, and a
  month with no orders in range still returning a real zero-value bucket,
  not an empty array - while leaving the totals/category breakdown
  untouched, that `fromDate`/`toDate` are rejected unless given together,
  that `toDate` before `fromDate` is rejected, that a range wider than
  `MAX_FILTERED_TREND_MONTHS` is rejected, and that omitting both keeps
  the default trailing-window trend), image uploads (including magic-byte content validation, not
  just declared MIME type), reviews, wishlist, business info, the in-app
  notification system (list/read, per-category preferences and their
  enforcement, admin preferences, the broadcast tool, account-activity
  triggers on login/password-change/profile-edit), and the CORS allowlist —
  including role-based access control (401/403) and input validation (400)
  on every route.
- **`tests/accountCleanup.test.ts`** — service-level test of the
  unverified-account warning/deletion job (see Features above).

Real-time delivery itself (the Socket.IO push) isn't exercised by the test
suite — tests call the real Express `app` directly and never start
`initRealtime()`, so `emitToUser()` is always a safe no-op there (see
`CLAUDE.md`). What's tested is everything up to that point: the
`Notification` row gets created correctly, and route/permission/preference
logic behaves as expected.

Every test file gets its own throwaway SQLite database under
`server/tests/` (created and migrated in `beforeAll`, deleted in `afterAll`)
so tests never touch `server/prisma/dev.db` and can't interfere with each
other. No network calls are made — the metals-refresh test asserts the
"API key not configured" error path rather than hitting metals.dev.

### Client tests

The client also runs on Vitest, plus [React Testing
Library](https://testing-library.com/react) for component tests - a
separate `client/vitest.config.mts` from the dev/build `vite.config.ts`
(the dev-proxy entries there are meaningless once every network call is
mocked). Tests are co-located next to the source they cover
(`Component.test.tsx` beside `Component.tsx`), unlike the server's
separate `tests/` directory - component tests benefit more from sitting
next to what they cover, while the server's integration-style tests share
one throwaway database per file and read more naturally grouped together.

```bash
cd client
npm test               # run everything once
npx vitest              # watch mode while developing
```

Coverage is intentionally critical-path, not exhaustive (this app has ~30
pages/components and no prior frontend test infrastructure at all) -
`Login.tsx` (redirect-by-role, error handling), `Cart.tsx` (quantity
updates, remove-with-confirm, checkout navigation, and reconciling stale
prices/stock against the live catalog on load - including a regression
test for a real race the hook implementing that once had: a quantity edit
mid-reconciliation must survive, not get silently reverted once the fetch
resolves) and `Checkout.tsx` (order submission, the unverified-account
prompt, and the same live-catalog reconciliation, since checkout can be
reached directly without passing through the cart page first),
`AdminDashboard.tsx`
and the `Navbar.tsx` notification bell (both chosen specifically to
regression-test the `.catch()`/retry fixes from the pre-launch audit
above), `Navbar.tsx`'s account menu and cart link (hidden for a signed-in
admin, shown to a customer and a signed-out visitor - shopping features
aren't relevant to an admin's own account), `ProtectedRoute.tsx` (the sign-in/home
redirects, `excludeRole` matching, and - since SUPER_ADMIN has every ADMIN
permission - that both `role="ADMIN"` and `excludeRole="ADMIN"` treat a
super admin exactly like a plain admin), `FeaturedCarousel.tsx` (responsive items-per-slide,
navigation/wrap-around, autoplay pause/resume, `prefers-reduced-motion`,
and the ARIA/`inert` accessibility structure - see `CLAUDE.md` for the
full behavior spec this test file covers), `AdminUserDetail.tsx`
(profile save with no `role` field in it, the seven stat cards - total
spending with/without a pending line, registration date, last login,
last-order-or-"No orders yet" with its "View order history" link,
account status text, OTP-verification status text, and the role select -
block-confirms/unblock-doesn't, both the role select's and the
OTP-verification select's immediate-save-no-confirmation, the "Send
payment reminder" button being hidden with no pending amount and shown
with one (and sending it with a success/error toast when clicked), that
the super admin's own role renders as a fixed "Super Admin (fixed)" label
rather than an editable select, and
delete-then-navigate-back), `AdminUserOrders.tsx` (the order-history table
moved out of `AdminUserDetail.tsx` - loading/error/retry, the order rows,
and the back link), `AdminUsers.tsx` (that each row's role and admin-note
cells render as plain text with no `<select>`/`<textarea>` in them - the
core regression test for the table's read-only rewrite - a note falling
back to an em dash when empty, the name linking to the detail page,
verified/blocked status badges, block-confirms/unblock-doesn't, delete
confirming first, the empty-filters message, load-error-retry,
creating a user from the "Add user" form, and - viewed as a plain admin -
that a customer row and the viewer's own row stay fully manageable while a
different admin's or the super admin's row shows its name as plain text
and "Restricted" in place of the action buttons), `AdminOrders.tsx` (the customer name linking to
`/admin/users/:id` or "Deleted user" with no link for an orphaned order,
the resend-invoice button's success/error toast, the print-invoice
control's link target/new-tab attribute, and permanently deleting orders -
a single row's delete button confirming before calling the API (and doing
nothing if declined), the "Delete selected" bulk action being disabled
until something's selected, "Delete all orders", the default sort/no-filter
state on load, that the search box (debounced), status filter (including
the "Earned" option), date range, and sort control each re-fetch with the
right query params, and that a `?status=EARNED`/`?status=PENDING` URL
param (how `AdminRevenue.tsx`'s "View orders" links arrive) seeds the
status filter on load, with an unrecognized value falling back to no
filter, and the payment method/currency selects - disabled while an order
sits at PENDING untouched, disabled for an already-saved CONFIRMED/
SHIPPED/DELIVERED/CANCELLED order (parametrized) with an explanatory
tooltip even when Status is still staged to that same value, enabled the
moment Status is staged to Confirmed on a not-yet-confirmed order, locked
again once that's actually saved (the order's own status catches up), and
that a disabled select genuinely can't be changed by a simulated user
interaction - the
existing bulk-status action is also covered), `AdminOrderInvoice.tsx` (loading an order, rendering its
items/total, the Print button calling `window.print()`, and
loading/error/retry), `AdminRevenue.tsx` (loading/error/retry,
the earned/pending totals, the category breakdown table, each stat
tile's "View orders" link pointing at `/admin/orders?status=EARNED`/
`?status=PENDING`, that "Apply" stays disabled until both the From and To
date inputs are filled in and doesn't refetch anything just from typing a
date, that applying calls the API with the right `{fromDate, toDate}`,
that an end date before the start date is rejected client-side with no
fetch at all, that the "Showing: `<From date>` - `<To date>`" line and the
"Clear filter" button only appear once a filter is actually applied, and
that "Clear filter" goes back to the unfiltered default - the
`recharts` trend chart itself is left untested, since its internal SVG
rendering isn't this app's own logic to verify), `AdminCommission.tsx`
(load/error/retry, all four gold/silver selling/buying values loading and
saving independently - the test fixture deliberately uses different gold
vs. silver values so cross-metal independence is actually exercised, not
just that a single shared value round-trips - and the ±$5,000 client-side
validation on a per-metal field - its own page/test file now, split out of
`AdminSettings.tsx`), `AdminSettings.tsx` (load/error/retry, the
OTP-verification toggle's immediate-save-with-confirmation-toast and its
revert-on-failure, the universal bypass code's own separate save, the
metal-price schedule toggle's immediate-save-with-revert-on-failure and
its independence from the "Refresh now" button, and the refresh-frequency
input's own save and its 1-1440 client-side validation),
`Register.tsx` (redirecting to `/verify-otp` vs. straight home,
depending on whether the account the server returned came back already
verified - see the OTP-verification-toggle feature above), and
`lib/api.test.ts` (`refreshAccessToken()`'s single-flight de-duplication -
concurrent callers share one in-flight `/auth/refresh` request rather than
each firing their own, a later call gets a genuinely fresh request once
the previous one has settled, and a failed request doesn't leave a stale
rejected promise behind for the next caller to reuse). `src/test/setup.ts`
explicitly wires up React Testing Library's
`afterEach(cleanup)` - this project doesn't set Vitest's `globals: true`
(tests import `describe`/`it`/`expect` explicitly, matching the server
suite's convention), so RTL's usual auto-cleanup registration (which looks
for a global `afterEach`) never fires on its own - and installs a no-op
`ResizeObserver` stub, which `recharts`' `ResponsiveContainer` needs to
mount at all under jsdom (which doesn't implement one).

## Notes

- Gold/silver prices are seeded with placeholder values so products have a
  real starting price out of the box. Set `METALS_API_KEY` and use
  "Refresh now" on Admin → Settings (or wait for the scheduled job, if
  enabled — see the toggle in the same section) to pull live prices.
- Scheduled (automatic) metal price fetches are rate-limited by the
  "Refresh frequency (minutes)" setting on Admin → Settings (default 60,
  admin-editable, 1-1440) to stay within the metals.dev free tier. "Refresh
  now" always fetches immediately regardless of this setting - an explicit
  admin click is never throttled, so repeated clicks each cost a real API
  call.
- Payments are stubbed: orders are created with a `DEFERRED` payment status
  and no money moves. See `server/src/modules/payments/payment.service.ts`
  to wire in a real provider later.
- Notifications (order confirmation/status emails) are stubbed to the
  console. See `server/src/modules/notifications/notification.service.ts`.
- The registration OTP is sent via Twilio; `server/.env` ships with dummy
  placeholder `TWILIO_*` values, so by default (and whenever Twilio
  rejects the configured credentials) the code is logged to the server
  console instead of actually texted — that's also how to complete
  registration locally without a real Twilio account. Set real
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER` to send
  real SMS messages. See `server/src/modules/sms/sms.service.ts`.
- To migrate from SQLite to MySQL later: change `provider` in
  `server/prisma/schema.prisma` to `"mysql"`, point `DATABASE_URL` at a MySQL
  instance, and re-run `prisma migrate deploy`.

## Troubleshooting

- **`EPERM`/`EADDRINUSE` on Windows when restarting the server**: `tsx` and
  Prisma's query engine can leave a Node process holding port 4000 or the
  Prisma client DLL after you stop a dev server. Close it with:
  `Get-Process node | Stop-Process -Force` (PowerShell), then restart.
- **Metal prices stuck at the seeded placeholder**: confirm `METALS_API_KEY`
  is set in `server/.env` and check the server log for `[metals]` messages —
  the *automatic* refresh is silently skipped (not errored) if one already
  ran within the configured "Refresh frequency (minutes)" (Admin →
  Settings), or if the automatic schedule toggle in that same section is
  off. Clicking "Refresh now" always fetches immediately regardless of
  either setting, so it's the quickest way to confirm whether the problem
  is really the API key/network versus just waiting on the schedule.
