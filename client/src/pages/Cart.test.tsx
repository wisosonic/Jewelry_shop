import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProduct, fetchProducts } from "../api/products";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useCartStore, type CartLine } from "../store/cartStore";
import type { Product } from "../types";
import { Cart } from "./Cart";

vi.mock("../api/products", () => ({ fetchProducts: vi.fn(), fetchProduct: vi.fn() }));
vi.mock("../context/ConfirmContext", () => ({ useConfirm: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: vi.fn() }));
// Shallow-rendered - Cart.tsx's own logic is what's under test here, not
// ProductCard's (which has its own wishlist/toast dependencies).
vi.mock("../components/product/ProductCard", () => ({
  ProductCard: ({ product }: { product: { name: string } }) => <div>{product.name}</div>,
}));

const mockedFetchProducts = vi.mocked(fetchProducts);
const mockedFetchProduct = vi.mocked(fetchProduct);
const mockedUseConfirm = vi.mocked(useConfirm);
const mockedUseToast = vi.mocked(useToast);

const LINE: CartLine = {
  productId: "p1",
  name: "Gold Ring",
  sku: "RING-1",
  imageUrl: null,
  unitPriceCents: 10000,
  quantity: 2,
  stockQuantity: 5,
};

// Matches LINE exactly - useSyncCartWithCatalog's reconciliation against
// this is a no-op, so tests that aren't specifically about that
// reconciliation can use this as the default `fetchProduct` response
// without it disturbing the cart state they're asserting on.
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

function renderCart() {
  return render(
    <MemoryRouter initialEntries={["/cart"]}>
      <Routes>
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<p>Checkout page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Cart", () => {
  beforeEach(() => {
    useCartStore.setState({ lines: [] });
    mockedFetchProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 8 });
    mockedFetchProduct.mockResolvedValue(UNCHANGED_PRODUCT);
    mockedUseConfirm.mockReturnValue(vi.fn().mockResolvedValue(true));
    mockedUseToast.mockReturnValue({ showToast: vi.fn() });
  });

  it("shows an empty-cart message with no lines", () => {
    renderCart();
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
  });

  it("lists a cart line, shows the running total, and updates it when quantity changes", async () => {
    useCartStore.setState({ lines: [LINE] });
    const user = userEvent.setup();
    renderCart();

    expect(screen.getByText("Gold Ring")).toBeInTheDocument();
    // With a single line, its own subtotal and the cart's grand total are
    // numerically identical ($200.00 either way) - scope to the total's own
    // aria-live region specifically to assert the right element renders it.
    const totalRegion = document.querySelector('[aria-live="polite"]');
    expect(totalRegion).not.toBeNull();
    expect(within(totalRegion as HTMLElement).getByText("$200.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /increase quantity/i }));
    expect(useCartStore.getState().lines[0].quantity).toBe(3);
  });

  it("confirms before removing a line, and does nothing if the shopper cancels", async () => {
    useCartStore.setState({ lines: [LINE] });
    const confirm = vi.fn().mockResolvedValue(false);
    mockedUseConfirm.mockReturnValue(confirm);
    const user = userEvent.setup();
    renderCart();

    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Gold Ring"), expect.any(Object));
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it("removes a line once the shopper confirms, and shows a toast", async () => {
    useCartStore.setState({ lines: [LINE] });
    const showToast = vi.fn();
    mockedUseToast.mockReturnValue({ showToast });
    const user = userEvent.setup();
    renderCart();

    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Removed"));
  });

  it("navigates to checkout", async () => {
    useCartStore.setState({ lines: [LINE] });
    const user = userEvent.setup();
    renderCart();

    await user.click(screen.getByRole("button", { name: /proceed to checkout/i }));
    expect(await screen.findByText("Checkout page")).toBeInTheDocument();
  });

  // useSyncCartWithCatalog.ts's reconciliation - see that file's own doc
  // comment for why a cart line's price/stock can't just be trusted from
  // add-to-cart time indefinitely.
  describe("reconciling against the live catalog", () => {
    it("updates a stale price to the current one and shows a toast", async () => {
      useCartStore.setState({ lines: [LINE] });
      mockedFetchProduct.mockResolvedValue({ ...UNCHANGED_PRODUCT, currentPriceCents: 12000 });
      const showToast = vi.fn();
      mockedUseToast.mockReturnValue({ showToast });
      renderCart();

      expect(await screen.findByText("$120.00 each")).toBeInTheDocument();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Price updated for 1 item"));
    });

    it("removes a line whose product is now inactive, and shows a toast", async () => {
      useCartStore.setState({ lines: [LINE] });
      mockedFetchProduct.mockResolvedValue({ ...UNCHANGED_PRODUCT, isActive: false });
      const showToast = vi.fn();
      mockedUseToast.mockReturnValue({ showToast });
      renderCart();

      expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("no longer available"), "error");
    });

    it("clamps quantity down when stock has dropped below the cart's quantity", async () => {
      useCartStore.setState({ lines: [LINE] }); // quantity 2
      mockedFetchProduct.mockResolvedValue({ ...UNCHANGED_PRODUCT, stockQuantity: 1 });
      const showToast = vi.fn();
      mockedUseToast.mockReturnValue({ showToast });
      renderCart();

      await vi.waitFor(() => expect(useCartStore.getState().lines[0].quantity).toBe(1));
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Quantity reduced for 1 item"));
    });

    it("doesn't clobber a quantity the shopper changes while the reconciliation fetch is still in flight", async () => {
      useCartStore.setState({ lines: [LINE] }); // quantity 2
      let resolveFetch!: (product: Product) => void;
      mockedFetchProduct.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
      const user = userEvent.setup();
      renderCart();

      // The shopper bumps the quantity to 3 before the in-flight reconciliation resolves.
      await user.click(screen.getByRole("button", { name: /increase quantity/i }));
      expect(useCartStore.getState().lines[0].quantity).toBe(3);

      // A distinguishable stockQuantity (9, not the original 5) so there's
      // an observable signal to wait on that can only be caused by the
      // reconciliation actually applying - unlike price/quantity, which
      // could otherwise coincidentally already match.
      resolveFetch({ ...UNCHANGED_PRODUCT, stockQuantity: 9 });
      await vi.waitFor(() => expect(useCartStore.getState().lines[0].stockQuantity).toBe(9));

      // The old (buggy) behavior would clamp against the quantity captured
      // when the fetch started (2), reverting the shopper's own edit back
      // down - min(2, 9) = 2. The fix re-reads the quantity fresh at apply
      // time, so it stays 3: min(3, 9) = 3.
      expect(useCartStore.getState().lines[0].quantity).toBe(3);
    });
  });
});
