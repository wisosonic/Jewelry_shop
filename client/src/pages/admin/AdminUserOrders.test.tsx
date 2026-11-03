import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUser, fetchUserOrderHistory } from "../../api/admin";
import type { Order, User } from "../../types";
import { AdminUserOrders } from "./AdminUserOrders";

vi.mock("../../api/admin", () => ({
  fetchUser: vi.fn(),
  fetchUserOrderHistory: vi.fn(),
}));

const mockedFetchUser = vi.mocked(fetchUser);
const mockedFetchUserOrderHistory = vi.mocked(fetchUserOrderHistory);

const CUSTOMER: User = {
  id: "u1",
  email: "shopper@test.com",
  name: "Jane Shopper",
  role: "CUSTOMER",
  phone: null,
  address: null,
  isVerified: true,
  isBlocked: false,
  createdAt: "2024-01-01T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/users/u1/orders"]}>
      <Routes>
        <Route path="/admin/users/:id/orders" element={<AdminUserOrders />} />
        <Route path="/admin/users/:id" element={<p>User detail page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminUserOrders", () => {
  beforeEach(() => {
    mockedFetchUser.mockResolvedValue(CUSTOMER);
    mockedFetchUserOrderHistory.mockResolvedValue([]);
  });

  it("shows the user's order history once loaded", async () => {
    const order: Order = {
      id: "order-12345678",
      userId: "u1",
      status: "PENDING",
      subtotalCents: 5000,
      totalCents: 5000,
      currency: "USD",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
    };
    mockedFetchUserOrderHistory.mockResolvedValue([order]);
    renderPage();

    expect(await screen.findByText(/order history/i)).toBeInTheDocument();
    expect(screen.getByText("#12345678")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument();
  });

  it("shows a message when the user has no orders", async () => {
    renderPage();
    expect(await screen.findByText(/hasn't placed any orders/i)).toBeInTheDocument();
  });

  it("shows an error with retry when loading fails", async () => {
    mockedFetchUserOrderHistory.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/couldn't load order history/i)).toBeInTheDocument();

    mockedFetchUserOrderHistory.mockResolvedValueOnce([]);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/hasn't placed any orders/i)).toBeInTheDocument();
  });

  it("links back to the user's detail page", async () => {
    renderPage();
    const backLink = await screen.findByRole("link", { name: /back to jane shopper/i });
    expect(backLink).toHaveAttribute("href", "/admin/users/u1");
  });
});
