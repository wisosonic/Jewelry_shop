import { Route, Routes } from "react-router-dom";
import { AdminLayout } from "./components/layout/AdminLayout";
import { Footer } from "./components/layout/Footer";
import { Navbar } from "./components/layout/Navbar";
import { OverrideBanner } from "./components/layout/OverrideBanner";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { BullionShop } from "./pages/BullionShop";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { NotificationPreferences } from "./pages/NotificationPreferences";
import { Notifications } from "./pages/Notifications";
import { OrderDetail } from "./pages/OrderDetail";
import { OrderHistory } from "./pages/OrderHistory";
import { ProductDetail } from "./pages/ProductDetail";
import { Profile } from "./pages/Profile";
import { Register } from "./pages/Register";
import { ResetPassword } from "./pages/ResetPassword";
import { Shop } from "./pages/Shop";
import { VerifyOtp } from "./pages/VerifyOtp";
import { Wishlist } from "./pages/Wishlist";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminOrderInvoice } from "./pages/admin/AdminOrderInvoice";
import { AdminOrders } from "./pages/admin/AdminOrders";
import { AdminProductForm } from "./pages/admin/AdminProductForm";
import { AdminProducts } from "./pages/admin/AdminProducts";
import { AdminBusinessInfo } from "./pages/admin/AdminBusinessInfo";
import { AdminCommission } from "./pages/admin/AdminCommission";
import { AdminNotifications } from "./pages/admin/AdminNotifications";
import { AdminRevenue } from "./pages/admin/AdminRevenue";
import { AdminSettings } from "./pages/admin/AdminSettings";
import { AdminUserDetail } from "./pages/admin/AdminUserDetail";
import { AdminUserOrders } from "./pages/admin/AdminUserOrders";
import { AdminUsers } from "./pages/admin/AdminUsers";

/**
 * Root layout and route table for the storefront and admin panel.
 * Renders the persistent navbar/footer chrome (plus the emergency override
 * banner, when active) and declares every route, gating checkout, profile
 * and the admin section behind `ProtectedRoute`. The navbar and banner are
 * wrapped in one sticky container (rather than each being independently
 * sticky) so they scroll away and pin back together as a single unit.
 */
function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-40">
        <Navbar />
        <OverrideBanner />
      </div>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bullion" element={<BullionShop />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:id" element={<ProductDetail />} />
          <Route
            path="/cart"
            element={
              <ProtectedRoute requireAuth={false} excludeRole="ADMIN">
                <Cart />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            path="/checkout"
            element={
              <ProtectedRoute excludeRole="ADMIN">
                <Checkout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/verify-otp"
            element={
              <ProtectedRoute>
                <VerifyOtp />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute excludeRole="ADMIN">
                <OrderHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <ProtectedRoute excludeRole="ADMIN">
                <OrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wishlist"
            element={
              <ProtectedRoute excludeRole="ADMIN">
                <Wishlist />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <Notifications />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications/preferences"
            element={
              <ProtectedRoute>
                <NotificationPreferences />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute role="ADMIN">
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="products/:id" element={<AdminProductForm />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="revenue" element={<AdminRevenue />} />
            <Route path="commission" element={<AdminCommission />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/:id" element={<AdminUserDetail />} />
            <Route path="users/:id/orders" element={<AdminUserOrders />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="business" element={<AdminBusinessInfo />} />
          </Route>

          {/* Deliberately a top-level route, not nested under /admin above -
              it must render without AdminLayout's sidebar/topbar chrome so
              printing it prints only the invoice (see AdminOrderInvoice.tsx). */}
          <Route
            path="/admin/orders/:id/invoice"
            element={
              <ProtectedRoute role="ADMIN">
                <AdminOrderInvoice />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default App;
