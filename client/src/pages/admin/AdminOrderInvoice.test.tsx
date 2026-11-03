import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOrder } from "../../api/orders";
import type { Order } from "../../types";
import { AdminOrderInvoice } from "./AdminOrderInvoice";

vi.mock("../../api/orders", () => ({ fetchOrder: vi.fn() }));

const mockedFetchOrder = vi.mocked(fetchOrder);

const ORDER: Order = {
  id: "order-12345678",
  userId: "u1",
  user: { id: "u1", email: "shopper@test.com", name: "Jane Shopper" },
  status: "CONFIRMED",
  subtotalCents: 5000,
  totalCents: 5000,
  currency: "USD",
  shippingAddress: "123 Main St",
  createdAt: "2024-06-01T00:00:00.000Z",
  updatedAt: "2024-06-01T00:00:00.000Z",
  items: [
    {
      id: "item1",
      productId: "p1",
      productNameSnapshot: "Gold Ring",
      skuSnapshot: "RING-1",
      quantity: 1,
      unitPriceCentsSnapshot: 5000,
      metalPricePerGramCentsSnapshot: 10000,
      commissionCentsPerTroyOunceSnapshot: 5000,
      lineTotalCents: 5000,
    },
  ],
};

function renderInvoice() {
  return render(
    <MemoryRouter initialEntries={["/admin/orders/order-12345678/invoice"]}>
      <Routes>
        <Route path="/admin/orders/:id/invoice" element={<AdminOrderInvoice />} />
        <Route path="/admin/orders" element={<p>Orders list page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminOrderInvoice", () => {
  beforeEach(() => {
    mockedFetchOrder.mockResolvedValue(ORDER);
  });

  it("loads and renders the order's items and total, plus a Print button", async () => {
    const printSpy = vi.fn();
    window.print = printSpy;
    const user = userEvent.setup();
    renderInvoice();

    expect(await screen.findByText("Invoice #12345678")).toBeInTheDocument();
    expect(screen.getByText(/Gold Ring/)).toBeInTheDocument();
    expect(screen.getByText(/Jane Shopper/)).toBeInTheDocument();
    expect(screen.getAllByText("$50.00").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /^print$/i }));
    expect(printSpy).toHaveBeenCalledOnce();
  });

  it("shows an error with retry when the order fails to load", async () => {
    mockedFetchOrder.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderInvoice();

    expect(await screen.findByText(/couldn't load this order/i)).toBeInTheDocument();

    mockedFetchOrder.mockResolvedValueOnce(ORDER);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Invoice #12345678")).toBeInTheDocument();
  });

  it("links back to the orders list", async () => {
    renderInvoice();
    const backLink = await screen.findByRole("link", { name: /back to orders/i });
    expect(backLink).toHaveAttribute("href", "/admin/orders");
  });
});
