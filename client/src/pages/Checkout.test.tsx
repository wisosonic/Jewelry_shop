import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder } from "../api/orders";
import { fetchProduct } from "../api/products";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useCartStore, type CartLine } from "../store/cartStore";
import type { Order, Product, User } from "../types";
import { Checkout } from "./Checkout";

vi.mock("../api/orders", () => ({ createOrder: vi.fn() }));
vi.mock("../api/products", () => ({ fetchProduct: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: vi.fn() }));

const mockedCreateOrder = vi.mocked(createOrder);
const mockedFetchProduct = vi.mocked(fetchProduct);
const mockedUseAuth = vi.mocked(useAuth);
const mockedUseToast = vi.mocked(useToast);

const CUSTOMER: User = {
  id: "u1",
  email: "shopper@test.com",
  name: "Shopper",
  role: "CUSTOMER",
  phone: null,
  address: "123 Main St",
  isVerified: true,
  isBlocked: false,
  createdAt: "2024-01-01T00:00:00.000Z",
};

const LINE: CartLine = {
  productId: "p1",
  name: "Gold Ring",
  sku: "RING-1",
  imageUrl: null,
  unitPriceCents: 10000,
  quantity: 2,
  stockQuantity: 5,
};

// Matches LINE exactly, so useSyncCartWithCatalog's reconciliation is a
// no-op for tests that aren't specifically about it.
const UNCHANGED_PRODUCT: Product = {
  id: "p1",
  sku: "RING-1",
  name: "Gold Ring",
  description: "d",
  productType: "JEWELRY",
  category: "RING",
  metalType: "GOLD",
  purity: 0.75,
  weightGrams: 2,
  makingChargeCents: 0,
  currentPriceCents: 10000,
  stockQuantity: 5,
  isActive: true,
  createdAt: "",
  updatedAt: "",
};

function renderCheckout() {
  return render(
    <MemoryRouter initialEntries={["/checkout"]}>
      <Routes>
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/orders/:id" element={<p>Order detail page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Checkout", () => {
  beforeEach(() => {
    useCartStore.setState({ lines: [] });
    mockedFetchProduct.mockResolvedValue(UNCHANGED_PRODUCT);
    mockedUseToast.mockReturnValue({ showToast: vi.fn() });
    mockedUseAuth.mockReturnValue({
      user: CUSTOMER,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  it("shows an empty-cart message with no lines", () => {
    renderCheckout();
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
  });

  it("submits the cart as a new order, clears it, and navigates to the order detail page", async () => {
    useCartStore.setState({ lines: [LINE] });
    mockedCreateOrder.mockResolvedValue({ id: "o1" } as Order);
    const user = userEvent.setup();
    renderCheckout();

    await user.click(screen.getByRole("button", { name: /place order/i }));

    expect(mockedCreateOrder).toHaveBeenCalledWith({
      items: [{ productId: "p1", quantity: 2 }],
      shippingAddress: "123 Main St",
    });
    expect(await screen.findByText("Order detail page")).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("shows a verification prompt and disables placing an order for an unverified account", () => {
    useCartStore.setState({ lines: [LINE] });
    mockedUseAuth.mockReturnValue({
      user: { ...CUSTOMER, isVerified: false },
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    renderCheckout();

    expect(screen.getByText(/verify your phone number/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /place order/i })).toBeDisabled();
  });

  // useSyncCartWithCatalog.ts's reconciliation - Checkout can be reached
  // directly (a bookmark, the back button) without passing back through
  // Cart.tsx first, so it needs to reconcile independently too.
  describe("reconciling against the live catalog", () => {
    it("updates a stale price to the current one before the order total is shown", async () => {
      useCartStore.setState({ lines: [LINE] });
      mockedFetchProduct.mockResolvedValue({ ...UNCHANGED_PRODUCT, currentPriceCents: 12000 });
      renderCheckout();

      // Both the line's own subtotal and the order's running total reflect
      // the updated price (with a single line, the two are numerically
      // identical - $240.00 either way).
      expect(await screen.findAllByText("$240.00")).toHaveLength(2);
    });

    it("removes a line whose product is now inactive", async () => {
      useCartStore.setState({ lines: [LINE] });
      mockedFetchProduct.mockResolvedValue({ ...UNCHANGED_PRODUCT, isActive: false });
      renderCheckout();

      expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
    });
  });
});
