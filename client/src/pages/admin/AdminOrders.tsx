import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  bulkDeleteOrders,
  bulkUpdateOrderStatus,
  deleteAllOrders,
  deleteOrder,
  fetchAllOrders,
  resendOrderInvoice,
  updateOrderAdminFields,
  type OrderSortField,
  type OrderStatusFilter,
} from "../../api/orders";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { formatCents, formatCentsPerTroyOunce, formatSignedCommissionPerTroyOunce } from "../../lib/format";
import type { Order, OrderStatus, PaymentCurrency, PaymentMethod } from "../../types";

const STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"];
// "EARNED" is a pseudo-status the *filter* dropdown alone offers (matching
// server-side ORDER_STATUS_FILTER_VALUES) - never a real value an order's
// own status can be set to, so it's deliberately not in STATUSES above,
// which also backs the per-row/bulk status-change <select>s.
const STATUS_FILTER_VALUES: OrderStatusFilter[] = [...STATUSES, "EARNED"];
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "WHISH_MONEY", label: "Whish Money" },
  { value: "CASH_ON_DELIVERY", label: "Cash on Delivery" },
];
const PAYMENT_CURRENCIES: PaymentCurrency[] = ["USD", "LBP"];

const SORT_OPTIONS = [
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "status-asc", label: "Status: A to Z" },
  { value: "status-desc", label: "Status: Z to A" },
  { value: "customer-asc", label: "Customer: A to Z" },
  { value: "customer-desc", label: "Customer: Z to A" },
] as const;
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

/** The admin-editable fields tracked locally per order row until "Save" commits them. */
type OrderEdits = { status: OrderStatus; paymentMethod: PaymentMethod | ""; paymentCurrency: PaymentCurrency };

function editsFor(order: Order): OrderEdits {
  return {
    status: order.status,
    paymentMethod: order.paymentMethod ?? "",
    paymentCurrency: order.paymentCurrency ?? "USD",
  };
}

/**
 * Whether the payment method/currency `<select>`s should be enabled for
 * this order right now - only while it's actively being confirmed (staged
 * status is CONFIRMED, but that isn't saved yet) - see the page's own doc
 * comment above for why this is narrower than "any time before confirmed."
 */
function paymentFieldsEnabled(order: Order, staged: OrderEdits | undefined): boolean {
  return staged?.status === "CONFIRMED" && order.status !== "CONFIRMED";
}

/**
 * Admin page listing every order with its line items, per-order edits for
 * status/payment method/payment currency (staged locally and committed via
 * a "Save" button once anything changes, rather than saving on every
 * keystroke/selection). **The payment method/currency `<select>`s are only
 * ever enabled in the exact moment an order is being confirmed** - the
 * *staged* Status `<select>` reads `"CONFIRMED"` while the order's own
 * last-*saved* status is still something else - `paymentFieldsEnabled()`.
 * They're disabled (with an explanatory `title` tooltip) the rest of the
 * time, including while an order simply sits at PENDING with no staged
 * change: not "any time before confirmed," but specifically the act of
 * confirming it, since that's the one moment recording how it was paid for
 * actually makes sense. Once CONFIRMED is actually saved, the order's own
 * status catches up to `"CONFIRMED"` too, so the condition goes false again
 * and the fields lock for good - there's no later window to edit them.
 * `orders.service.ts`'s `updateOrderAdminFields()` enforces the identical
 * rule server-side (400 unless this same request both changes a payment
 * field *and* moves status to CONFIRMED from something else) - a disabled
 * `<select>` alone can't stop a direct API call. A bulk
 * status-change action, permanent deletion
 * (single, bulk-selected, and all-at-once - see the "permanently deletes
 * orders" domain bullet in CLAUDE.md for why this is a genuine hard
 * delete, unlike everywhere else in this app an order is "removed"), and
 * search/filter/sort (customer name/email/order id, status - including an
 * "EARNED" pseudo-status matching every earned status at once, seeded from
 * a `?status=` URL param so `AdminRevenue.tsx`'s "View orders" buttons can
 * deep-link straight to a filtered view - a creation date range, and
 * sorting by date/status/customer - all server-side, the same query-param
 * convention `AdminUsers.tsx`/`AdminProducts.tsx` already use rather than
 * filtering an already-fetched list client-side).
 */
export function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [edits, setEdits] = useState<Record<string, OrderEdits>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<OrderStatus>("CONFIRMED");
  const [loadError, setLoadError] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  // Seeded once from the URL (e.g. /admin/orders?status=EARNED, linked from
  // AdminRevenue.tsx) so a deep link lands pre-filtered - later changes to
  // this filter are plain local state, not written back to the URL.
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter | "">(() => {
    const fromUrl = searchParams.get("status");
    return (STATUS_FILTER_VALUES as string[]).includes(fromUrl ?? "") ? (fromUrl as OrderStatusFilter) : "";
  });
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<SortValue>("createdAt-desc");
  const [sortBy, sortOrder] = sort.split("-") as [OrderSortField, "asc" | "desc"];

  /** (Re)loads the order list from the server (honoring the current search/filter/sort) and resets any staged, unsaved edits. */
  function load() {
    setLoadError(false);
    fetchAllOrders({
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      sortBy,
      sortOrder,
    })
      .then((data) => {
        setOrders(data);
        setEdits(Object.fromEntries(data.map((order) => [order.id, editsFor(order)])));
        setSelectedIds(new Set());
      })
      .catch(() => setLoadError(true));
  }

  useEffect(load, [debouncedSearch, statusFilter, fromDate, toDate, sort]);

  /** Whether an order's staged edits differ from its last-saved values. */
  function isDirty(order: Order) {
    const staged = edits[order.id];
    if (!staged) return false;
    const saved = editsFor(order);
    return staged.status !== saved.status || staged.paymentMethod !== saved.paymentMethod || staged.paymentCurrency !== saved.paymentCurrency;
  }

  function updateEdit(orderId: string, patch: Partial<OrderEdits>) {
    setEdits((current) => ({ ...current, [orderId]: { ...current[orderId], ...patch } }));
  }

  /** Commits an order's staged status/payment-method/payment-currency edits to the server. */
  async function handleSaveOrder(order: Order) {
    const staged = edits[order.id];
    if (!staged) return;
    try {
      await updateOrderAdminFields(order.id, {
        status: staged.status,
        paymentMethod: staged.paymentMethod || null,
        paymentCurrency: staged.paymentCurrency,
      });
      load();
      showToast("Order updated.");
    } catch {
      showToast("Couldn't update this order.", "error");
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => (current.size === orders.length ? new Set() : new Set(orders.map((o) => o.id))));
  }

  async function handleBulkStatusChange() {
    try {
      await bulkUpdateOrderStatus([...selectedIds], bulkStatus);
      load();
      showToast("Order statuses updated.");
    } catch {
      showToast("Couldn't update the selected orders.", "error");
    }
  }

  /** Re-sends an order's invoice to its customer as a fresh in-app notification - see orders.service.ts's resendInvoice(). */
  async function handleResendInvoice(order: Order) {
    try {
      await resendOrderInvoice(order.id);
      showToast("Invoice resent.");
    } catch {
      showToast("Couldn't resend this invoice.", "error");
    }
  }

  /** Confirms, then permanently deletes a single order - not the same as cancelling it (see orders.service.ts's deleteOrder()). */
  async function handleDeleteOrder(order: Order) {
    const confirmed = await confirm(`Permanently delete order #${order.id.slice(-8)}? This cannot be undone.`, {
      title: "Delete order",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteOrder(order.id);
      load();
      showToast("Order deleted.");
    } catch {
      showToast("Couldn't delete this order.", "error");
    }
  }

  async function handleBulkDelete() {
    const confirmed = await confirm(
      `Permanently delete ${selectedIds.size} selected order(s)? This cannot be undone.`,
      { title: "Delete orders", confirmLabel: "Delete", danger: true }
    );
    if (!confirmed) return;
    try {
      await bulkDeleteOrders([...selectedIds]);
      load();
      showToast("Selected orders deleted.");
    } catch {
      showToast("Couldn't delete the selected orders.", "error");
    }
  }

  /** The single most destructive action on this page - wipes every order in the system, no filter, no undo. */
  async function handleDeleteAll() {
    const confirmed = await confirm(
      `Permanently delete ALL ${orders.length} order(s) in the system? This cannot be undone and will remove them from order history and every revenue report.`,
      { title: "Delete all orders", confirmLabel: "Delete all orders", danger: true }
    );
    if (!confirmed) return;
    try {
      const count = await deleteAllOrders();
      load();
      showToast(`Deleted ${count} order(s).`);
    } catch {
      showToast("Couldn't delete all orders.", "error");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink-900 sm:text-3xl">Orders</h1>
        <button
          onClick={handleDeleteAll}
          disabled={orders.length === 0}
          className="rounded-full border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          Delete all orders
        </button>
      </div>

      {loadError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load orders.{" "}
          <button onClick={load} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer name, email, or order #..."
          aria-label="Search orders"
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OrderStatusFilter | "")}
          aria-label="Filter by status"
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="EARNED">Earned (Confirmed/Shipped/Delivered)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-900/60">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
            className="rounded-full border border-brand-300 px-3 py-1.5 text-sm text-ink-900"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-900/60">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
            className="rounded-full border border-brand-300 px-3 py-1.5 text-sm text-ink-900"
          />
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortValue)}
          aria-label="Sort orders"
          className="rounded-full border border-brand-300 px-4 py-2 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="text-sm text-ink-900/50">{orders.length} order{orders.length === 1 ? "" : "s"}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm">
        <input
          type="checkbox"
          checked={orders.length > 0 && selectedIds.size === orders.length}
          onChange={toggleSelectAll}
          aria-label="Select all orders"
        />
        <span className="font-medium text-ink-900">{selectedIds.size} selected</span>
        <select
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value as OrderStatus)}
          className="rounded-lg border border-brand-300 px-3 py-1.5"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={handleBulkStatusChange}
          disabled={selectedIds.size === 0}
          className="rounded-full border border-brand-300 bg-white px-3 py-1.5 text-ink-900/80 hover:bg-brand-100 disabled:opacity-40"
        >
          Apply to selected
        </button>
        <button
          onClick={handleBulkDelete}
          disabled={selectedIds.size === 0}
          className="rounded-full border border-red-300 bg-white px-3 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          Delete selected
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {orders.map((order) => (
          <div key={order.id} className="rounded-xl border border-brand-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(order.id)}
                  onChange={() => toggleSelected(order.id)}
                  aria-label={`Select order #${order.id.slice(-8)}`}
                  className="mt-1.5"
                />
                <div>
                  <p className="font-medium text-ink-900">Order #{order.id.slice(-8)}</p>
                  {/* order.user is null for an "orphaned" order whose account has since been deleted - see the Order.userId schema comment (server). */}
                  <p className="text-sm text-ink-900/60">
                    {order.user ? (
                      <>
                        <Link to={`/admin/users/${order.user.id}`} className="text-brand-600 hover:underline">
                          {order.user.name}
                        </Link>{" "}
                        &middot; {order.user.email}
                      </>
                    ) : (
                      "Deleted user"
                    )}
                  </p>
                  <p className="text-sm text-ink-900/60">{new Date(order.createdAt).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-brand-700">{formatCents(order.totalCents, order.currency)}</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleResendInvoice(order)}
                    className="rounded-full border border-brand-300 bg-white px-3 py-1.5 text-xs text-ink-900/80 hover:bg-brand-100"
                  >
                    Resend invoice
                  </button>
                  <a
                    href={`/admin/orders/${order.id}/invoice`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-brand-300 bg-white px-3 py-1.5 text-xs text-ink-900/80 hover:bg-brand-100"
                  >
                    Print invoice
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDeleteOrder(order)}
                    className="rounded-full border border-red-300 bg-white px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-brand-100 pt-3">
              <label className="text-xs text-ink-900/60">
                Status
                <select
                  value={edits[order.id]?.status ?? order.status}
                  onChange={(e) => updateEdit(order.id, { status: e.target.value as OrderStatus })}
                  className="mt-1 block rounded-lg border border-brand-300 px-3 py-2 text-sm text-ink-900"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              {(() => {
                const canEditPayment = paymentFieldsEnabled(order, edits[order.id]);
                const lockedTitle = canEditPayment
                  ? undefined
                  : "Only editable while confirming this order (set Status to CONFIRMED, then set payment method/currency together, then Save).";
                return (
                  <>
                    <label className="text-xs text-ink-900/60">
                      Payment method
                      <select
                        value={edits[order.id]?.paymentMethod ?? ""}
                        onChange={(e) => updateEdit(order.id, { paymentMethod: e.target.value as PaymentMethod | "" })}
                        disabled={!canEditPayment}
                        title={lockedTitle}
                        className="mt-1 block rounded-lg border border-brand-300 px-3 py-2 text-sm text-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">Not set</option>
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-ink-900/60">
                      Payment currency
                      <select
                        value={edits[order.id]?.paymentCurrency ?? "USD"}
                        onChange={(e) => updateEdit(order.id, { paymentCurrency: e.target.value as PaymentCurrency })}
                        disabled={!canEditPayment}
                        title={lockedTitle}
                        className="mt-1 block rounded-lg border border-brand-300 px-3 py-2 text-sm text-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {PAYMENT_CURRENCIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </>
                );
              })()}
              {isDirty(order) && (
                <button
                  onClick={() => handleSaveOrder(order)}
                  className="rounded-full bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
                >
                  Save
                </button>
              )}
            </div>

            <ul className="mt-3 space-y-1 border-t border-brand-100 pt-3 text-sm text-ink-900/70">
              {order.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3">
                  <span>{item.productNameSnapshot} &times; {item.quantity}</span>
                  <span className="text-xs text-ink-900/50">
                    metal @ {formatCentsPerTroyOunce(item.metalPricePerGramCentsSnapshot, order.currency)}/oz &middot;{" "}
                    <span className="font-medium text-green-600">
                      {formatSignedCommissionPerTroyOunce(item.commissionCentsPerTroyOunceSnapshot, order.currency)}/oz
                    </span>{" "}
                    commission
                  </span>
                  <span>{formatCents(item.lineTotalCents, order.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
