import type { Role } from "../types";

/**
 * Role-hierarchy helpers mirroring `server/src/utils/roles.ts` - keep both
 * in sync. `SUPER_ADMIN` has every `ADMIN` permission plus the ability to
 * manage other admin accounts (see CLAUDE.md's `SUPER_ADMIN` bullet), so
 * every "is this an admin" UI check in this client should go through
 * {@link isAdminRole} rather than a raw `=== "ADMIN"` comparison, the same
 * way the server's `authorize()`/service-level checks do.
 */
export function isAdminRole(role: Role | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
