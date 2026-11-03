import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteUser, fetchUser, fetchUserOrderSummary, sendPaymentReminder, updateUser } from "../../api/admin";
import { useConfirm } from "../../context/ConfirmContext";
import { useToast } from "../../context/ToastContext";
import type { User, UserOrderSummary } from "../../types";
import { AdminUserDetail } from "./AdminUserDetail";

vi.mock("../../api/admin", () => ({
  fetchUser: vi.fn(),
  fetchUserOrderSummary: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  sendPaymentReminder: vi.fn(),
}));
vi.mock("../../context/ConfirmContext", () => ({ useConfirm: vi.fn() }));
vi.mock("../../context/ToastContext", () => ({ useToast: vi.fn() }));

const mockedFetchUser = vi.mocked(fetchUser);
const mockedFetchUserOrderSummary = vi.mocked(fetchUserOrderSummary);
const mockedUpdateUser = vi.mocked(updateUser);
const mockedDeleteUser = vi.mocked(deleteUser);
const mockedSendPaymentReminder = vi.mocked(sendPaymentReminder);
const mockedUseConfirm = vi.mocked(useConfirm);
const mockedUseToast = vi.mocked(useToast);

const CUSTOMER: User = {
  id: "u1",
  email: "shopper@test.com",
  name: "Jane Shopper",
  role: "CUSTOMER",
  phone: "+1-555-0100",
  address: "123 Main St",
  isVerified: true,
  isBlocked: false,
  adminNotes: "",
  createdAt: "2024-01-15T00:00:00.000Z",
  lastLoginAt: "2024-06-01T00:00:00.000Z",
};

const EMPTY_SUMMARY: UserOrderSummary = { totalSpentCents: 0, totalPendingCents: 0, lastOrder: null };

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/admin/users/u1"]}>
      <Routes>
        <Route path="/admin/users/:id" element={<AdminUserDetail />} />
        <Route path="/admin/users" element={<p>Users list page</p>} />
        <Route path="/admin/users/:id/orders" element={<p>Order history page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminUserDetail", () => {
  const showToast = vi.fn();

  beforeEach(() => {
    showToast.mockClear();
    mockedFetchUser.mockResolvedValue(CUSTOMER);
    mockedFetchUserOrderSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedUseConfirm.mockReturnValue(vi.fn().mockResolvedValue(true));
    mockedUseToast.mockReturnValue({ showToast });
  });

  it("loads and shows the user's profile fields", async () => {
    renderDetail();
    expect(await screen.findByDisplayValue("Jane Shopper")).toBeInTheDocument();
    expect(screen.getByDisplayValue("shopper@test.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("+1-555-0100")).toBeInTheDocument();
  });

  it("shows an error with retry when the user fails to load", async () => {
    mockedFetchUser.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByText(/couldn't load this user/i)).toBeInTheDocument();

    mockedFetchUser.mockResolvedValueOnce(CUSTOMER);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByDisplayValue("Jane Shopper")).toBeInTheDocument();
  });

  it("saves edited profile fields (role is no longer part of this form)", async () => {
    const updated = { ...CUSTOMER, name: "Jane Updated" };
    mockedUpdateUser.mockResolvedValue(updated);
    const user = userEvent.setup();
    renderDetail();

    const nameInput = await screen.findByDisplayValue("Jane Shopper");
    await user.clear(nameInput);
    await user.type(nameInput, "Jane Updated");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mockedUpdateUser).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ name: "Jane Updated", email: "shopper@test.com" })
    );
    expect(mockedUpdateUser.mock.calls[0][1]).not.toHaveProperty("role");
  });

  it("shows the stat cards: total spending (with pending), registration date, last login, last order, account status, OTP verification, and role", async () => {
    mockedFetchUserOrderSummary.mockResolvedValue({
      totalSpentCents: 15000,
      totalPendingCents: 5000,
      lastOrder: { id: "order-abcdef12", status: "PENDING", totalCents: 5000, currency: "USD", createdAt: "2024-06-15T00:00:00.000Z" },
    });
    renderDetail();

    expect(await screen.findByText("$150.00")).toBeInTheDocument();
    expect(screen.getByText(/\$50\.00 pending/i)).toBeInTheDocument();
    expect(screen.getByText(new Date(CUSTOMER.createdAt).toLocaleDateString())).toBeInTheDocument();
    expect(screen.getByText(/#abcdef12/)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Verified", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /otp verification status/i })).toHaveValue("true");
    expect(screen.getByRole("combobox", { name: /user role/i })).toHaveValue("CUSTOMER");

    const viewHistoryLink = screen.getByRole("link", { name: /view order history/i });
    expect(viewHistoryLink).toHaveAttribute("href", "/admin/users/u1/orders");
  });

  it("shows 'No orders yet' and still links to order history when there are none", async () => {
    renderDetail();
    expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view order history/i })).toHaveAttribute(
      "href",
      "/admin/users/u1/orders"
    );
  });

  it("hides the 'Send payment reminder' button when the user has no pending payments", async () => {
    renderDetail();
    await screen.findByText(/no orders yet/i);
    expect(screen.queryByRole("button", { name: /send payment reminder/i })).not.toBeInTheDocument();
  });

  it("shows a 'Send payment reminder' button when pending, and sends it on click", async () => {
    mockedFetchUserOrderSummary.mockResolvedValue({
      totalSpentCents: 0,
      totalPendingCents: 5000,
      lastOrder: { id: "order-pending01", status: "PENDING", totalCents: 5000, currency: "USD", createdAt: "2024-06-15T00:00:00.000Z" },
    });
    mockedSendPaymentReminder.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail();

    const reminderButton = await screen.findByRole("button", { name: /send payment reminder/i });
    await user.click(reminderButton);

    expect(mockedSendPaymentReminder).toHaveBeenCalledWith("u1");
    expect(showToast).toHaveBeenCalledWith("Payment reminder sent.");
  });

  it("shows an error toast when sending the payment reminder fails", async () => {
    mockedFetchUserOrderSummary.mockResolvedValue({
      totalSpentCents: 0,
      totalPendingCents: 5000,
      lastOrder: null,
    });
    mockedSendPaymentReminder.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /send payment reminder/i }));

    expect(showToast).toHaveBeenCalledWith("Couldn't send this payment reminder.", "error");
  });

  it("blocks a user after confirming, and unblocks without confirming", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    mockedUseConfirm.mockReturnValue(confirm);
    mockedUpdateUser.mockResolvedValue({ ...CUSTOMER, isBlocked: true });
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /^block$/i }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mockedUpdateUser).toHaveBeenCalledWith("u1", { isBlocked: true });
    expect(await screen.findByText(/blocked from placing orders/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^unblock$/i })).toBeInTheDocument();

    confirm.mockClear();
    mockedUpdateUser.mockResolvedValue({ ...CUSTOMER, isBlocked: false });
    await user.click(screen.getByRole("button", { name: /^unblock$/i }));
    expect(confirm).not.toHaveBeenCalled();
    expect(mockedUpdateUser).toHaveBeenCalledWith("u1", { isBlocked: false });
  });

  it("changes the role immediately on select, with no confirmation", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    mockedUseConfirm.mockReturnValue(confirm);
    mockedUpdateUser.mockResolvedValue({ ...CUSTOMER, role: "ADMIN" });
    const user = userEvent.setup();
    renderDetail();

    const roleSelect = await screen.findByRole("combobox", { name: /user role/i });
    await user.selectOptions(roleSelect, "ADMIN");

    expect(mockedUpdateUser).toHaveBeenCalledWith("u1", { role: "ADMIN" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("changes the OTP-verification status immediately on select, with no confirmation", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    mockedUseConfirm.mockReturnValue(confirm);
    mockedUpdateUser.mockResolvedValue({ ...CUSTOMER, isVerified: false });
    const user = userEvent.setup();
    renderDetail();

    const verifiedSelect = await screen.findByRole("combobox", { name: /otp verification status/i });
    expect(verifiedSelect).toHaveValue("true");
    await user.selectOptions(verifiedSelect, "false");

    expect(mockedUpdateUser).toHaveBeenCalledWith("u1", { isVerified: false });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows the super admin's role as a fixed label, not an editable select", async () => {
    mockedFetchUser.mockResolvedValue({ ...CUSTOMER, role: "SUPER_ADMIN" });
    renderDetail();

    expect(await screen.findByText(/super admin \(fixed\)/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /user role/i })).not.toBeInTheDocument();
  });

  it("deletes the user after confirming, and navigates back to the list", async () => {
    mockedDeleteUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /delete user/i }));
    expect(mockedDeleteUser).toHaveBeenCalledWith("u1");
    expect(await screen.findByText("Users list page")).toBeInTheDocument();
  });
});
