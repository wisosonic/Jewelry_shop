/**
 * The full set of `User.role` string values (plain `String` column, not a
 * Prisma enum - see the "Role/status/category fields are plain String"
 * domain invariant in CLAUDE.md) and the role-hierarchy helpers built on
 * top of it. See CLAUDE.md's "SUPER_ADMIN" bullet for the full design.
 */

/** Every role this app has. `SUPER_ADMIN` is deliberately not in {@link ASSIGNABLE_ROLES} below - see that const's comment for why. */
export const ROLES = ["CUSTOMER", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Roles that can actually be granted through the user-management API
 * (`POST /users`'s `role`, `PATCH /users/:id`'s `role`) - `users.schema.ts`
 * validates both against this list, not the full {@link ROLES}.
 * `SUPER_ADMIN` is deliberately excluded: it's a single, non-assignable
 * role, seeded directly by `prisma/seed.ts` (the only other writer of
 * `User.role`) and never grantable via the API. Since nothing can ever
 * write `"SUPER_ADMIN"` through the API, and the seed script only ever
 * upserts the one seeded admin account, at most one `SUPER_ADMIN` can ever
 * exist - by construction, not a runtime uniqueness check.
 */
export const ASSIGNABLE_ROLES = ["CUSTOMER", "ADMIN"] as const;

/**
 * Roles with admin-level access - `SUPER_ADMIN` has every `ADMIN`
 * permission plus the ability to manage other admin accounts (see
 * `users.service.ts`'s `assertCanManageTarget()`). Most admin-gated routes
 * never need to import this directly: `middleware/auth.ts`'s `authorize()`
 * already treats a route gated with just `"ADMIN"` as satisfied by
 * `SUPER_ADMIN` too. This export exists for the handful of service-level
 * `role === "ADMIN"` checks that aren't expressed as route middleware
 * (`orders.service.ts`'s `createOrder()`/`getOrder()`/`cancelOrder()`,
 * `wishlist.service.ts`'s `addToWishlist()`, `products.service.ts`'s
 * `listProducts()`, `notifyAdminsOfEvent()`'s admin lookup).
 */
export const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

/** True for `"ADMIN"` or `"SUPER_ADMIN"` - see {@link ADMIN_ROLES}. */
export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
