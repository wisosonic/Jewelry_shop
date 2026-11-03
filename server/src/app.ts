import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { businessRouter } from "./modules/business/business.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { metalsRouter } from "./modules/metals/metals.routes";
import { notificationsRouter } from "./modules/notifications/inAppNotifications.routes";
import { ordersRouter } from "./modules/orders/orders.routes";
import { productsRouter } from "./modules/products/products.routes";
import { revenueRouter } from "./modules/revenue/revenue.routes";
import { reviewsRouter } from "./modules/reviews/reviews.routes";
import { settingsRouter } from "./modules/settings/settings.routes";
import { uploadsRouter } from "./modules/uploads/uploads.routes";
import { usersRouter } from "./modules/users/users.routes";
import { wishlistRouter } from "./modules/wishlist/wishlist.routes";

/**
 * Express application setup: global middleware (security headers, CORS,
 * JSON body parsing, cookies, static uploads), health check, and the
 * versioned `/api/v1` router mounting every feature module's routes,
 * followed by the 404 and error handlers.
 */
export const app = express();

// `crossOriginResourcePolicy` is relaxed from helmet's "same-origin" default
// because `/uploads/*` (product images) is plain public content fetched
// cross-origin by the client (a different origin/port in dev, and possibly
// a different domain in production) - the strict default would make the
// browser refuse to load them.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
// Multiple allowed origins (env.clientOrigins, parsed from a comma-separated
// CLIENT_ORIGIN) rather than one static string, so the same deployment can
// serve requests from more than one known frontend (e.g. a marketing
// domain and an app subdomain, or staging alongside production) - but
// still an explicit allowlist, never `origin: true`/`"*"`. Reflecting any
// origin would actually be *rejected* by browsers here anyway (the CORS
// spec disallows a wildcard alongside `credentials: true`), and even if it
// weren't, doing so would let any website make authenticated requests
// using a signed-in visitor's cookies - the refresh-token cookie this API
// relies on. A request with no Origin header at all (curl, server-to-server
// calls, same-origin requests) is allowed through, same as `cors()`'s
// default behavior when `origin` is a plain string.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.clientOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin "${origin}" is not allowed by CORS`));
      }
    },
    credentials: true,
  })
);
// This is the *only* place CORS is configured, mounted before every route
// below (health check, static uploads, and the whole /api/v1 router) -
// Express applies middleware in registration order, so nothing later in
// this file can be reached without first passing through it. Don't add a
// second `cors()` call on an individual router/route; extend
// `env.clientOrigins` instead if another origin needs to be allowed.
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Versioned from day one: payments/shipping integrations will likely force
// breaking changes to the orders/products contracts later, and versioning
// after the fact is much more painful than starting with it.
const v1 = express.Router();
v1.use("/auth", authRouter);
v1.use("/users", usersRouter);
v1.use("/products", productsRouter);
v1.use("/products/:productId/reviews", reviewsRouter);
v1.use("/wishlist", wishlistRouter);
v1.use("/orders", ordersRouter);
v1.use("/metals", metalsRouter);
v1.use("/notifications", notificationsRouter);
v1.use("/settings", settingsRouter);
v1.use("/business", businessRouter);
v1.use("/dashboard", dashboardRouter);
v1.use("/revenue", revenueRouter);
v1.use("/uploads", uploadsRouter);
app.use("/api/v1", v1);

app.use(notFoundHandler);
app.use(errorHandler);
