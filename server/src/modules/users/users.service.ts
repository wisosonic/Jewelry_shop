import { prisma } from "../../db/prisma";
import { createNotification } from "../notifications/inAppNotifications.service";
import { EARNED_ORDER_STATUSES, PENDING_ORDER_STATUSES } from "../orders/orders.schema";
import { AppError } from "../../utils/AppError";
import { hashPassword, verifyPassword } from "../../utils/password";
import { isAdminRole } from "../../utils/roles";

/** Business logic for user CRUD and order history lookup. */

/** Prisma `select` shape that omits sensitive fields (e.g. password hash) from user records. */
const publicSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  address: true,
  role: true,
  isVerified: true,
  // Set on password login only (auth.service.ts's loginUser()) - see that
  // field's schema comment. Not sensitive, so exposed the same as createdAt.
  lastLoginAt: true,
  // Admin-set, order-placement-only restriction (see the field's schema
  // comment) - visible to the account owner too, same tier as isVerified,
  // since a customer whose checkout starts failing has a real reason to
  // know why.
  isBlocked: true,
  createdAt: true,
};

// Adds admin-only fields on top of `publicSelect` - only ever used when the
// requester is an ADMIN (see `selectFor` below), so a customer
// viewing/updating their own profile never receives them, regardless of
// route. `deletionWarningSentAt` lets AdminUsers.tsx flag an unverified
// account that's already been warned it's about to be auto-deleted (see
// modules/accountCleanup) - not something a customer needs to see about
// themselves.
const adminSelect = { ...publicSelect, adminNotes: true, deletionWarningSentAt: true };

/** Picks the right select shape for who's asking - only an admin (or the super admin) ever sees `adminNotes`. */
function selectFor(viewerRole: string) {
  return isAdminRole(viewerRole) ? adminSelect : publicSelect;
}

/**
 * Guards the "only the super admin can manage other admin accounts" rule
 * (see CLAUDE.md's `SUPER_ADMIN` bullet): a plain `ADMIN` may view/edit/
 * delete any `CUSTOMER` account and their own account, but not another
 * `ADMIN` or the `SUPER_ADMIN` account - only a `SUPER_ADMIN` caller can.
 * A no-op for a `SUPER_ADMIN` requester (unrestricted) and for a requester
 * acting on their own account (self-service edits are a different rule,
 * handled by the field-stripping in `users.controller.ts`'s `update()`).
 * Requires the *target's current* role, since neither the request body nor
 * the caller's own JWT reveal it.
 * @throws {AppError} 403 if a plain ADMIN is targeting a different ADMIN/SUPER_ADMIN account.
 */
function assertCanManageTarget(requester: { id: string; role: string }, target: { id: string; role: string }) {
  if (requester.role !== "ADMIN") return;
  if (requester.id === target.id) return;
  if (target.role !== "CUSTOMER") {
    throw AppError.forbidden("Only the super admin can manage other admin accounts.");
  }
}

/**
 * Lists users, paginated, optionally filtered by a name/email search and/or
 * role, and sorted by name/email/creation date. Admin-only route, so always
 * includes `adminNotes`.
 */
export async function listUsers(query: {
  page: number;
  pageSize: number;
  search?: string;
  role?: string;
  sortBy: "name" | "email" | "createdAt";
  sortOrder: "asc" | "desc";
}) {
  const where: Record<string, unknown> = {};
  if (query.role) where.role = query.role;
  if (query.search) {
    where.OR = [{ name: { contains: query.search } }, { email: { contains: query.search } }];
  }

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: adminSelect,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** The password assigned to a user an admin creates without specifying one - must be communicated to them out of band, since there's no email/SMS delivery in this app. */
const DEFAULT_TEMP_PASSWORD = "User@12345";

/** Turns a name into a placeholder email on the store's own domain, used when an admin creates a user without supplying one. */
function emailFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || "user"}@nayasofia.com`;
}

/**
 * Creates a user directly (admin only, not the self-registration flow).
 * When `email` is omitted, a placeholder is derived from `name` and
 * de-duplicated with a numeric suffix if it's already taken; when
 * `password` is omitted, it defaults to `DEFAULT_TEMP_PASSWORD`.
 * @throws {AppError} 409 if an explicitly-given email is already registered.
 */
export async function createUser(input: {
  name: string;
  email?: string;
  password?: string;
  role?: string;
  phone?: string;
  address?: string;
}) {
  let email = input.email?.trim().toLowerCase();
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw AppError.conflict("An account with this email already exists");
  } else {
    const base = emailFromName(input.name);
    email = base;
    let suffix = 2;
    while (await prisma.user.findUnique({ where: { email } })) {
      email = base.replace("@", `${suffix}@`);
      suffix += 1;
    }
  }

  const passwordHash = await hashPassword(input.password ?? DEFAULT_TEMP_PASSWORD);
  return prisma.user.create({
    data: {
      name: input.name,
      email,
      passwordHash,
      role: input.role ?? "CUSTOMER",
      phone: input.phone,
      address: input.address,
    },
    select: adminSelect,
  });
}

/**
 * Fetches a single user by id, including `adminNotes` only if the requester
 * is an admin (or the super admin).
 * @throws {AppError} 404 if no such user exists, 403 if the requester is a
 * plain ADMIN viewing a different ADMIN/SUPER_ADMIN account (see
 * `assertCanManageTarget()`).
 */
export async function getUser(id: string, viewerRole: string, viewerId: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: selectFor(viewerRole) });
  if (!user) throw AppError.notFound("User not found");
  assertCanManageTarget({ id: viewerId, role: viewerRole }, { id: user.id, role: user.role });
  return user;
}

/**
 * Updates a user's profile fields, hashing a new password if one is provided.
 * When `requireCurrentPassword` is set (the account owner changing their own
 * password, as opposed to an admin resetting someone else's), the supplied
 * `currentPassword` must match the stored hash first. The response includes
 * `adminNotes` only if `viewerRole` is `"ADMIN"` - the controller is
 * responsible for stripping `adminNotes`/`isBlocked`/`email`/`isVerified`
 * from `input` first when the caller isn't an admin, the same way it
 * already strips a smuggled `role`. `isVerified` is a manual admin
 * override of the normal OTP-verification flow (see the domain invariant
 * on registration/OTP) - flipping it doesn't touch any pending `OtpCode`
 * row or re-run any of that flow's checks, it just sets the flag directly,
 * the same way the flow itself does on success.
 * @throws {AppError} 401 if `requireCurrentPassword` is set and `currentPassword` doesn't match,
 * 409 if `email` is being changed to one already in use by another account,
 * 403 if the caller is a plain ADMIN updating a different ADMIN/SUPER_ADMIN
 * account (see `assertCanManageTarget()`).
 */
export async function updateUser(
  id: string,
  input: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    password?: string;
    currentPassword?: string;
    role?: string;
    adminNotes?: string;
    isBlocked?: boolean;
    isVerified?: boolean;
  },
  options: { requireCurrentPassword?: boolean; viewerRole?: string; viewerId?: string } = {}
) {
  const data: Record<string, unknown> = { ...input };
  delete data.password;
  delete data.currentPassword;

  if (options.viewerRole && options.viewerId) {
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (target) assertCanManageTarget({ id: options.viewerId, role: options.viewerRole }, { id, role: target.role });
  }

  // `email` has a DB-level @unique, same as at creation time (createUser()
  // above) - without this check, changing to an already-used address would
  // otherwise surface as a raw Prisma unique-constraint error instead of a
  // clean 409.
  if (input.email !== undefined) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing && existing.id !== id) {
      throw AppError.conflict("An account with this email already exists");
    }
  }

  if (input.password) {
    if (options.requireCurrentPassword) {
      const existing = await prisma.user.findUnique({ where: { id } });
      const valid = existing && input.currentPassword
        ? await verifyPassword(input.currentPassword, existing.passwordHash)
        : false;
      if (!valid) throw AppError.unauthorized("Current password is incorrect");
    }
    data.passwordHash = await hashPassword(input.password);
  }

  const user = await prisma.user.update({ where: { id }, data, select: selectFor(options.viewerRole ?? "CUSTOMER") });

  // Both are "account activity" (see the ACCOUNT_ACTIVITY category in
  // inAppNotifications.schema.ts). Awaited (not a detached fire-and-forget,
  // which would race the response) but `.catch()`'d so a notification
  // failure can never undo an update that already succeeded. Targets the
  // account owner (`id`) regardless of whether they made the change
  // themselves or an admin made it for them - it's their account either way.
  if (input.password) {
    await createNotification({ userId: id, type: "PASSWORD_CHANGED", message: "Your password was changed." }).catch(() => {});
  }
  if (
    input.name !== undefined ||
    input.email !== undefined ||
    input.phone !== undefined ||
    input.address !== undefined
  ) {
    await createNotification({ userId: id, type: "PROFILE_UPDATED", message: "Your profile details were updated." }).catch(() => {});
  }

  return user;
}

/**
 * Permanently deletes a user by id. Always succeeds regardless of order
 * history - every other relation (notifications, tokens, wishlist,
 * reviews, etc.) cascade-deletes, but `Order.userId` is `onDelete: SetNull`
 * (see that field's schema comment), so any orders this account placed
 * survive, detached rather than deleted, preserving the financial/audit
 * record.
 * @throws {AppError} 403 if `requester` is a plain ADMIN deleting a
 * different ADMIN/SUPER_ADMIN account (see `assertCanManageTarget()`).
 */
export async function deleteUser(id: string, requester: { id: string; role: string }) {
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (target) assertCanManageTarget(requester, { id, role: target.role });
  await prisma.user.delete({ where: { id } });
}

/** Lists a user's orders (with line items), most recent first. */
export function getOrderHistory(userId: string) {
  return prisma.order.findMany({
    where: { userId },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Summarizes one user's order activity for the admin user-detail page's
 * stat cards: total spent (earned) vs. total pending, and their most
 * recent order. Reuses the exact same `EARNED_ORDER_STATUSES`/
 * `PENDING_ORDER_STATUSES` classification `revenue.service.ts` uses for
 * the store-wide revenue report, so "earned vs pending" has one definition
 * shared by both surfaces, not two similar-but-different ones - `CANCELLED`
 * counts as neither (void revenue, not deferred revenue). A lighter query
 * than `getOrderHistory()` above (no items, just a status-grouped sum plus
 * the single most recent row) since the stat cards don't need line items.
 */
export async function getOrderSummary(userId: string) {
  const [statusTotals, lastOrder] = await Promise.all([
    prisma.order.groupBy({
      by: ["status"],
      where: { userId, status: { in: [...EARNED_ORDER_STATUSES, ...PENDING_ORDER_STATUSES] } },
      _sum: { totalCents: true },
    }),
    prisma.order.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);

  const earned = new Set<string>(EARNED_ORDER_STATUSES);
  let totalSpentCents = 0;
  let totalPendingCents = 0;
  for (const row of statusTotals) {
    const sum = row._sum.totalCents ?? 0;
    if (earned.has(row.status)) totalSpentCents += sum;
    else totalPendingCents += sum;
  }

  return { totalSpentCents, totalPendingCents, lastOrder };
}

/**
 * Sends a user a one-off in-app reminder about their pending (unpaid)
 * orders - an admin action from `AdminUserDetail.tsx`'s "Total spending"
 * stat card, not an automatic/scheduled reminder (there is no scheduler
 * for this, unlike `accountCleanup.service.ts`'s deletion-warning job).
 * Reuses the exact same `PENDING_ORDER_STATUSES` bucket `getOrderSummary()`
 * already sums, so "pending payment" means exactly what that card already
 * shows the admin - not a second, separately-computed definition.
 * @throws {AppError} 404 if no such user exists, 400 if they have no pending payments to remind about.
 */
export async function sendPaymentReminder(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound("User not found");

  const pending = await prisma.order.aggregate({
    where: { userId, status: { in: [...PENDING_ORDER_STATUSES] } },
    _sum: { totalCents: true },
  });
  const totalPendingCents = pending._sum?.totalCents ?? 0;
  if (totalPendingCents === 0) {
    throw AppError.badRequest("This user has no pending payments to remind about.");
  }

  // Reuses ORDER_UPDATES (see PAYMENT_REMINDER's CATEGORY_BY_TYPE entry) -
  // this is a real in-app notification, not email/SMS, per the
  // in-app-only-for-customers domain invariant in CLAUDE.md; a resend of an
  // existing order's own status doesn't qualify for one of that rule's two
  // named exceptions.
  await createNotification({
    userId,
    type: "PAYMENT_REMINDER",
    message: `You have a pending payment of $${(totalPendingCents / 100).toFixed(2)}. Please complete it at your earliest convenience.`,
    link: "/orders",
  });
}
