import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isAdminRole } from "../../lib/roles";
import type { Role } from "../../types";

/** True when `userRole` satisfies the `gate` role - an exact match, except `gate === "ADMIN"` is also satisfied by `SUPER_ADMIN` (see `lib/roles.ts`'s `isAdminRole()`), the same hierarchy the server's `authorize()` applies. */
function matchesRoleGate(userRole: Role | undefined, gate: Role): boolean {
  return gate === "ADMIN" ? isAdminRole(userRole) : userRole === gate;
}

/**
 * Route guard that renders `children` only once auth has resolved and the
 * user is signed in (and, when `role` is given, has that role, or when
 * `excludeRole` is given, does *not* have that role) — otherwise redirects to
 * login or home. Used to gate checkout, profile, admin, and (via
 * `excludeRole="ADMIN"`) the shopping-only cart/wishlist/order-history
 * routes, which aren't relevant to an admin's own account (see the identical
 * note on `ProductCard.tsx`) - `SUPER_ADMIN` is excluded from those shopping
 * routes too, via the same `matchesRoleGate()` hierarchy that lets it into
 * `role="ADMIN"` routes. `requireAuth={false}` (only `/cart` uses this)
 * skips the sign-in requirement while still applying `excludeRole` — the
 * cart is browsable signed-out, just not as a signed-in admin.
 */
export function ProtectedRoute({
  children,
  role,
  excludeRole,
  requireAuth = true,
}: {
  children: ReactNode;
  role?: Role;
  excludeRole?: Role;
  requireAuth?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="p-8 text-center text-ink-900/60">Loading...</div>;
  if (requireAuth && !user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (role && !matchesRoleGate(user?.role, role)) return <Navigate to="/" replace />;
  if (excludeRole && matchesRoleGate(user?.role, excludeRole)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
