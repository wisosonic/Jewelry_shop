import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bulkDeleteOrders,
  bulkUpdateOrderStatus,
  deleteAllOrders,
  deleteOrder,
  fetchAllOrders,
  resendOrderInvoice,
} from "../../api/orders";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import type { Order } from "../../types";
import { AdminOrders } from "./AdminOrders";

vi.mock("../../api/orders", () => ({
  fetchAllOrders: vi.fn(),
  bulkUpdateOrderStatus: vi.fn(),
  updateOrderAdminFields: vi.fn(),
  resendOrderInvoice: vi.fn(),
  deleteOrder: vi.fn(),
  bulkDeleteOrders: vi.fn(),
  deleteAllOrders: vi.fn(),
}));
vi.mock("../../context/ConfirmContext", () => ({ useConfirm: vi.fn() }));
vi.mock("../../context/ToastContext", () => ({ useToast: vi.fn() }));

const mockedFetchAllOrders = vi.mocked(fetchAllOrders);
const mockedBulkUpdateOrderStatus = vi.mocked(bulkUpdateOrderStatus);
const mockedResendOrderInvoice = vi.mocked(resendOrderInvoice);
const mockedDeleteOrder = vi.mocked(deleteOrder);
const mockedBulkDeleteOrders = vi.mocked(bulkDeleteOrders);
const mockedDeleteAllOrders = vi.mocked(deleteAllOrders);
const mockedUseConfirm = vi.mocked(useConfirm);
const mockedUseToast = vi.mocked(useToast);

const ORDER: Order = {
  id: "order-12345678",
  userId: "u1",
  user: { id: "u1", email: "shopper@test.com", name: "Jane Shopper" },
  status: "PENDING",
  subtotalCents: 5000,
  totalCents: 5000,
  currency: "USD",
  createdAt: "2024-06-01T00:00:00.000Z",
  updatedAt: "2024-06-01T00:00:00.000Z",
  items: [],
};

function renderOrders(initialPath = "/admin/orders") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdminOrders />
    </MemoryRouter>
  );
}

describe("AdminOrders", () => {
  const showToast = vi.fn();
  const confirm = vi.fn();

  beforeEach(() => {
    mockedFetchAllOrders.mockResolvedValue([ORDER]);
    mockedUseToast.mockReturnValue({ showToast });
    showToast.mockClear();
    confirm.mockReset().mockResolvedValue(true);
    mockedUseConfirm.mockReturnValue(confirm);
  });

  it("links the customer name to their admin user-detail page", async () => {
    renderOrders();
    const link = await screen.findByRole("link", { name: "Jane Shopper" });
    expect(link).toHaveAttribute("href", "/admin/users/u1");
  });

  it("shows 'Deleted user' with no link for an orphaned order", async () => {
    mockedFetchAllOrders.mockResolvedValue([{ ...ORDER, userId: null, user: null }]);
    renderOrders();
    expect(await screen.findByText("Deleted user")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jane Shopper" })).not.toBeInTheDocument();
  });

  it("resends the invoice and shows a success toast", async () => {
    mockedResendOrderInvoice.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderOrders();

    await user.click(await screen.findByRole("button", { name: /resend invoice/i }));
    expect(mockedResendOrderInvoice).toHaveBeenCalledWith("order-12345678");
    expect(showToast).toHaveBeenCalledWith("Invoice resent.");
  });

  it("shows an error toast when resending the invoice fails", async () => {
    mockedResendOrderInvoice.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderOrders();

    await user.click(await screen.findByRole("button", { name: /resend invoice/i }));
    expect(showToast).toHaveBeenCalledWith("Couldn't resend this invoice.", "error");
  });

  it("links the print-invoice control to the dedicated invoice page, opened in a new tab", async () => {
    renderOrders();
    const printLink = await screen.findByRole("link", { name: /print invoice/i });
    expect(printLink).toHaveAttribute("href", "/admin/orders/order-12345678/invoice");
    expect(printLink).toHaveAttribute("target", "_blank");
  });

  // Sanity check that the pre-existing bulk-status action still works unchanged.
  it("applies a bulk status change to selected orders", async () => {
    mockedBulkUpdateOrderStatus.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderOrders();

    await screen.findByText("Jane Shopper");
    await user.click(screen.getByLabelText(/select all orders/i));
    await user.click(screen.getByRole("button", { name: /apply to selected/i }));

    expect(mockedBulkUpdateOrderStatus).toHaveBeenCalledWith(["order-12345678"], "CONFIRMED");
  });

  it("deletes a single order after confirming", async () => {
    mockedDeleteOrder.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderOrders();

    await user.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mockedDeleteOrder).toHaveBeenCalledWith("order-12345678");
    expect(showToast).toHaveBeenCalledWith("Order deleted.");
  });

  it("does not delete a single order when the confirmation is declined", async () => {
    confirm.mockResolvedValue(false);
    const user = userEvent.setup();
    renderOrders();

    await user.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(mockedDeleteOrder).not.toHaveBeenCalled();
  });

  it("shows an error toast when deleting a single order fails", async () => {
    mockedDeleteOrder.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderOrders();

    await user.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(showToast).toHaveBeenCalledWith("Couldn't delete this order.", "error");
  });

  it("bulk-deletes selected orders after confirming", async () => {
    mockedBulkDeleteOrders.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderOrders();

    await screen.findByText("Jane Shopper");
    await user.click(screen.getByLabelText(/select all orders/i));
    await user.click(screen.getByRole("button", { name: /delete selected/i }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(mockedBulkDeleteOrders).toHaveBeenCalledWith(["order-12345678"]);
    expect(showToast).toHaveBeenCalledWith("Selected orders deleted.");
  });

  it("the delete-selected button is disabled until at least one order is selected", async () => {
    renderOrders();
    await screen.findByText("Jane Shopper");
    expect(screen.getByRole("button", { name: /delete selected/i })).toBeDisabled();
  });

  it("deletes all orders after confirming, and shows how many were removed", async () => {
    mockedDeleteAllOrders.mockResolvedValue(1);
    const user = userEvent.setup();
    renderOrders();

    await screen.findByText("Jane Shopper");
    await user.click(screen.getByRole("button", { name: /delete all orders/i }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatch(/permanently delete all 1/i);
    expect(mockedDeleteAllOrders).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith("Deleted 1 order(s).");
  });

  it("does not delete all orders when the confirmation is declined", async () => {
    confirm.mockResolvedValue(false);
    const user = userEvent.setup();
    renderOrders();

    await screen.findByText("Jane Shopper");
    await user.click(screen.getByRole("button", { name: /delete all orders/i }));
    expect(mockedDeleteAllOrders).not.toHaveBeenCalled();
  });

  it("loads with the default sort (newest first) and no filters", async () => {
    renderOrders();
    await screen.findByText("Jane Shopper");
    expect(mockedFetchAllOrders).toHaveBeenCalledWith({
      search: undefined,
      status: undefined,
      fromDate: undefined,
      toDate: undefined,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("re-fetches with the search term once typing settles (debounced)", async () => {
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");
    mockedFetchAllOrders.mockClear();

    await user.type(screen.getByLabelText(/search orders/i), "alice");

    await waitFor(() => {
      expect(mockedFetchAllOrders).toHaveBeenCalledWith(expect.objectContaining({ search: "alice" }));
    });
  });

  it("re-fetches when the status filter changes", async () => {
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");
    mockedFetchAllOrders.mockClear();

    await user.selectOptions(screen.getByLabelText(/filter by status/i), "CANCELLED");

    await waitFor(() => {
      expect(mockedFetchAllOrders).toHaveBeenCalledWith(expect.objectContaining({ status: "CANCELLED" }));
    });
  });

  it("re-fetches when the date range changes", async () => {
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");
    mockedFetchAllOrders.mockClear();

    await user.type(screen.getByLabelText(/from date/i), "2024-01-01");
    await user.type(screen.getByLabelText(/to date/i), "2024-01-31");

    await waitFor(() => {
      expect(mockedFetchAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({ fromDate: "2024-01-01", toDate: "2024-01-31" })
      );
    });
  });

  it("re-fetches with the chosen sort field and direction", async () => {
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");
    mockedFetchAllOrders.mockClear();

    await user.selectOptions(screen.getByLabelText(/sort orders/i), "customer-asc");

    await waitFor(() => {
      expect(mockedFetchAllOrders).toHaveBeenCalledWith(expect.objectContaining({ sortBy: "customer", sortOrder: "asc" }));
    });
  });

  it("seeds the status filter from a ?status=EARNED URL param - deep-linked from AdminRevenue.tsx's Earned card", async () => {
    renderOrders("/admin/orders?status=EARNED");
    await screen.findByText("Jane Shopper");

    expect(mockedFetchAllOrders).toHaveBeenCalledWith(expect.objectContaining({ status: "EARNED" }));
    expect(screen.getByLabelText(/filter by status/i)).toHaveValue("EARNED");
  });

  it("seeds the status filter from a ?status=PENDING URL param - deep-linked from AdminRevenue.tsx's Pending card", async () => {
    renderOrders("/admin/orders?status=PENDING");
    await screen.findByText("Jane Shopper");

    expect(mockedFetchAllOrders).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING" }));
  });

  it("ignores an invalid ?status= URL value, falling back to no filter", async () => {
    renderOrders("/admin/orders?status=NOT_A_REAL_STATUS");
    await screen.findByText("Jane Shopper");

    expect(mockedFetchAllOrders).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });

  it("offers Earned as a status filter option and re-fetches when it's selected", async () => {
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");
    mockedFetchAllOrders.mockClear();

    await user.selectOptions(screen.getByLabelText(/filter by status/i), "EARNED");

    await waitFor(() => {
      expect(mockedFetchAllOrders).toHaveBeenCalledWith(expect.objectContaining({ status: "EARNED" }));
    });
  });

  it("disables the payment method/currency selects while the order sits at PENDING with no staged change", async () => {
    renderOrders();
    await screen.findByText("Jane Shopper");

    expect(screen.getByLabelText(/^payment method$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^payment currency$/i)).toBeDisabled();
  });

  it.each(["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"] as const)(
    "disables the payment method/currency selects for an already-saved %s order, even with Status still staged to that same value",
    async (status) => {
      mockedFetchAllOrders.mockResolvedValue([{ ...ORDER, status }]);
      renderOrders();
      await screen.findByText("Jane Shopper");

      const paymentMethodSelect = screen.getByLabelText(/^payment method$/i);
      const paymentCurrencySelect = screen.getByLabelText(/^payment currency$/i);
      expect(paymentMethodSelect).toBeDisabled();
      expect(paymentCurrencySelect).toBeDisabled();
      expect(paymentMethodSelect).toHaveAttribute("title", expect.stringMatching(/confirming this order/i));
      expect(paymentCurrencySelect).toHaveAttribute("title", expect.stringMatching(/confirming this order/i));
    }
  );

  it("enables the payment method/currency selects only once Status is staged to CONFIRMED on a not-yet-confirmed order", async () => {
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");

    expect(screen.getByLabelText(/^payment method$/i)).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/^status$/i), "CONFIRMED");

    expect(screen.getByLabelText(/^payment method$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^payment currency$/i)).toBeEnabled();
  });

  it("locks the payment fields again once CONFIRMED is actually saved (order.status catches up)", async () => {
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");

    await user.selectOptions(screen.getByLabelText(/^status$/i), "CONFIRMED");
    expect(screen.getByLabelText(/^payment method$/i)).toBeEnabled();

    // Simulating the post-save reload: the order itself is now CONFIRMED.
    mockedFetchAllOrders.mockResolvedValue([{ ...ORDER, status: "CONFIRMED" }]);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByLabelText(/^payment method$/i)).toBeDisabled();
  });

  it("a disabled payment method select can't be changed by the user", async () => {
    mockedFetchAllOrders.mockResolvedValue([{ ...ORDER, status: "CONFIRMED" }]);
    const user = userEvent.setup();
    renderOrders();
    await screen.findByText("Jane Shopper");

    const paymentMethodSelect = screen.getByLabelText(/^payment method$/i);
    await user.selectOptions(paymentMethodSelect, "CASH_ON_DELIVERY").catch(() => {});
    // userEvent refuses to interact with a disabled element - the value never changes.
    expect(paymentMethodSelect).toHaveValue("");
  });
});
