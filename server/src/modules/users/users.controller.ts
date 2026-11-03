import { Request, Response } from "express";
import { AppError } from "../../utils/AppError";
import { isAdminRole } from "../../utils/roles";
import * as usersService from "./users.service";

/** HTTP handlers for listing, viewing, updating, and deleting users, and viewing order history. */

/** Lists users, paginated, filterable and sortable (admin only). */
export async function list(req: Request, res: Response) {
  res.json(await usersService.listUsers(req.query as never));
}

/** Creates a new user directly (admin only). */
export async function create(req: Request, res: Response) {
  res.status(201).json({ user: await usersService.createUser(req.body) });
}

/**
 * Fetches a single user by id; `adminNotes` is included only if the caller
 * is an admin (or the super admin). `usersService.getUser()` additionally
 * 403s if the caller is a plain ADMIN viewing a different ADMIN/SUPER_ADMIN
 * account - see CLAUDE.md's `SUPER_ADMIN` bullet.
 */
export async function get(req: Request, res: Response) {
  res.json({ user: await usersService.getUser(req.params.id, req.user!.role, req.user!.id) });
}

/**
 * Guards a request to the user's own resource unless the caller is an admin
 * (or the super admin - see `isAdminRole()`).
 * @throws {AppError} 403 if the caller is neither an admin nor the resource owner.
 */
function assertSelfOrAdmin(req: Request) {
  if (!isAdminRole(req.user!.role) && req.user!.id !== req.params.id) {
    throw AppError.forbidden();
  }
}

/**
 * Updates a user's profile; only an admin (or the super admin) may change
 * `role`, `adminNotes`, `isBlocked`, `email`, or `isVerified` (a smuggled
 * value for any of the five is silently dropped for a non-admin caller - a
 * customer must never be able to unblock, re-email, or self-verify via
 * their own profile-edit form). If the caller is changing their own
 * password (as opposed to an admin resetting someone else's), the current
 * password must be supplied and verified first. `usersService.updateUser()`
 * additionally 403s if the caller is a plain ADMIN updating a different
 * ADMIN/SUPER_ADMIN account - only the super admin can manage other admin
 * accounts (see CLAUDE.md's `SUPER_ADMIN` bullet).
 */
export async function update(req: Request, res: Response) {
  assertSelfOrAdmin(req);
  const body = { ...req.body };
  const isAdmin = isAdminRole(req.user!.role);
  if (body.role && !isAdmin) delete body.role;
  if (body.adminNotes !== undefined && !isAdmin) delete body.adminNotes;
  if (body.isBlocked !== undefined && !isAdmin) delete body.isBlocked;
  if (body.email !== undefined && !isAdmin) delete body.email;
  if (body.isVerified !== undefined && !isAdmin) delete body.isVerified;
  const isSelf = req.user!.id === req.params.id;
  res.json({
    user: await usersService.updateUser(req.params.id, body, {
      requireCurrentPassword: isSelf && !!body.password,
      viewerRole: req.user!.role,
      viewerId: req.user!.id,
    }),
  });
}

/** Deletes a user (admin only; the super admin can delete anyone, a plain ADMIN can't delete another ADMIN/SUPER_ADMIN - see `usersService.deleteUser()`). */
export async function remove(req: Request, res: Response) {
  await usersService.deleteUser(req.params.id, { id: req.user!.id, role: req.user!.role });
  res.status(204).send();
}

/** Returns a user's order history. */
export async function orderHistory(req: Request, res: Response) {
  assertSelfOrAdmin(req);
  res.json({ orders: await usersService.getOrderHistory(req.params.id) });
}

/** Returns a user's order-activity summary (total spent/pending, last order) for the admin stat cards. */
export async function orderSummary(req: Request, res: Response) {
  assertSelfOrAdmin(req);
  res.json(await usersService.getOrderSummary(req.params.id));
}

/** Sends a user an in-app reminder about their pending (unpaid) orders (admin only). */
export async function sendPaymentReminder(req: Request, res: Response) {
  await usersService.sendPaymentReminder(req.params.id);
  res.status(204).send();
}
