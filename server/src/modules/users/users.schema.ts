import { z } from "zod";
import { ASSIGNABLE_ROLES, ROLES } from "../../utils/roles";

/** Validation schemas for user route params and request bodies. */

/** Validates a route `:id` path param. */
export const idParamSchema = z.object({ id: z.string().min(1) });

export const USER_SORT_FIELDS = ["name", "email", "createdAt"] as const;

/**
 * Query params accepted by the user listing endpoint: pagination, a
 * name/email search, a role filter, and sorting. The role filter accepts
 * the full {@link ROLES} (including `SUPER_ADMIN`) - filtering by a role is
 * not the same as *assigning* one, so it's fine for an admin to look up
 * who the super admin is this way, unlike `adminUpdateUserSchema`/
 * `createUserSchema` below, which only accept {@link ASSIGNABLE_ROLES}.
 */
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.enum(ROLES).optional(),
  sortBy: z.enum(USER_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Request body schema for a user updating their own profile. `currentPassword`
 * is only required when `password` is being changed by the account owner
 * (enforced in the service, not here, since that depends on who's calling).
 */
export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  password: z.string().min(10).optional(),
  currentPassword: z.string().optional(),
});

/**
 * Request body schema for an admin updating a user, additionally allowing
 * role changes, an email change, the private admin-only note, the
 * order-placement block/unblock switch, and a manual OTP-verification
 * override. Applied to the route regardless of caller (self or admin) -
 * `users.controller.ts` strips
 * `role`/`adminNotes`/`isBlocked`/`email`/`isVerified` from the body first
 * if the caller isn't an admin, the same pattern for all five fields.
 * `email` isn't on the base `updateProfileSchema` - self-service profile
 * edits still can't change it, only an admin can (see `users.service.ts`'s
 * `updateUser()` for the uniqueness check this needs). `role` only accepts
 * {@link ASSIGNABLE_ROLES} - `SUPER_ADMIN` can never be granted through
 * this endpoint (see that const's comment) - and, separately,
 * `users.service.ts`'s `assertCanManageTarget()` blocks a plain `ADMIN`
 * caller from updating any field at all on another `ADMIN`/`SUPER_ADMIN`
 * account (only the super admin can manage other admin accounts).
 */
export const adminUpdateUserSchema = updateProfileSchema.extend({
  email: z.string().email().optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  adminNotes: z.string().max(2000).optional(),
  isBlocked: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

/**
 * Request body schema for an admin creating a new user directly (not via
 * self-registration). `email`/`password` are optional - `users.service.ts`'s
 * `createUser()` fills in a name-derived placeholder email and a shared
 * temporary password when omitted, since there's no email/SMS delivery in
 * this app to send real credentials with. `role` only accepts
 * {@link ASSIGNABLE_ROLES} - `SUPER_ADMIN` can never be created this way,
 * same restriction as `adminUpdateUserSchema` above.
 */
export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  password: z.string().min(10).optional(),
  role: z.enum(ASSIGNABLE_ROLES).default("CUSTOMER"),
  phone: z.string().optional(),
  address: z.string().optional(),
});
