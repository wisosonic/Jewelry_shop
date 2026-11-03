import { Request, Response } from "express";
import * as ordersService from "./orders.service";
import { ORDER_SORT_FIELDS } from "./orders.schema";
import { isAdminRole } from "../../utils/roles";

/** HTTP handlers for placing orders and viewing/managing order status. */

/** Places a new order for the authenticated user. */
export async function create(req: Request, res: Response) {
  const order = await ordersService.createOrder(req.user!.id, req.body);
  res.status(201).json({ order });
}

/**
 * Lists orders: all orders for admins passing `?all=true` (optionally
 * filtered/sorted - see `listOrdersQuerySchema`), otherwise the caller's
 * own (paginated, no filtering).
 */
export async function list(req: Request, res: Response) {
  const query = req.query as unknown as {
    all?: string;
    page: number;
    pageSize: number;
    search?: string;
    status?: string;
    fromDate?: Date;
    toDate?: Date;
    sortBy: (typeof ORDER_SORT_FIELDS)[number];
    sortOrder: "asc" | "desc";
  };
  if (isAdminRole(req.user!.role) && query.all === "true") {
    return res.json({
      orders: await ordersService.listAllOrders({
        search: query.search,
        status: query.status,
        fromDate: query.fromDate,
        toDate: query.toDate,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      }),
    });
  }
  res.json(await ordersService.listOrdersForUser(req.user!.id, { page: query.page, pageSize: query.pageSize }));
}

/** Fetches a single order, if the caller owns it or is an admin. */
export async function get(req: Request, res: Response) {
  res.json({ order: await ordersService.getOrder(req.params.id, req.user!) });
}

/** Updates an order's status, payment method, and/or payment currency (admin only). */
export async function updateAdminFields(req: Request, res: Response) {
  res.json({ order: await ordersService.updateOrderAdminFields(req.params.id, req.body) });
}

/** Updates several orders' status at once (admin only). */
export async function bulkUpdateStatus(req: Request, res: Response) {
  await ordersService.bulkUpdateOrderStatus(req.body.ids, req.body.status);
  res.status(204).send();
}

/** Cancels an order, if the caller owns it (or is an admin) and it's still in a cancellable stage. */
export async function cancel(req: Request, res: Response) {
  res.json({ order: await ordersService.cancelOrder(req.params.id, req.user!) });
}

/** Re-sends an order's invoice to its customer as a fresh in-app notification (admin only). */
export async function resendInvoice(req: Request, res: Response) {
  await ordersService.resendInvoice(req.params.id);
  res.status(204).send();
}

/** Permanently deletes a single order (admin only). */
export async function remove(req: Request, res: Response) {
  await ordersService.deleteOrder(req.params.id);
  res.status(204).send();
}

/** Permanently deletes several orders at once (admin only). */
export async function bulkDelete(req: Request, res: Response) {
  await ordersService.bulkDeleteOrders(req.body.ids);
  res.status(204).send();
}

/** Permanently deletes every order in the system (admin only) - responds with how many were removed. */
export async function deleteAll(req: Request, res: Response) {
  const count = await ordersService.deleteAllOrders();
  res.json({ count });
}
