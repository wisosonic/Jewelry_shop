import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import type { Product, User } from "../../types";
import { ProductCard } from "./ProductCard";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../context/ToastContext", () => ({ useToast: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseToast = vi.mocked(useToast);
mockedUseToast.mockReturnValue({ showToast: vi.fn() });

const CUSTOMER: User = {
  id: "u1",
  email: "shopper@test.com",
  name: "Shopper",
  role: "CUSTOMER",
  phone: null,
  address: null,
  isVerified: true,
  isBlocked: false,
  createdAt: "2024-01-01T00:00:00.000Z",
};

const ADMIN: User = { ...CUSTOMER, id: "u2", name: "Admin User", role: "ADMIN" };

const PRODUCT: Product = {
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

function renderCard(user: User | null) {
  mockedUseAuth.mockReturnValue({
    user,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  });
  return render(
    <MemoryRouter>
      <ProductCard product={PRODUCT} />
    </MemoryRouter>
  );
}

// Wishlist/cart are shopping features, not relevant to an admin's own
// account (see the identical note in ProductCard.tsx) - hidden entirely
// for a signed-in admin, but still shown to a signed-out visitor (clicking
// prompts sign-in, unrelated to this restriction) and to a customer.
describe("ProductCard admin restrictions", () => {
  it("shows the wishlist and quick-add-to-cart buttons for a customer", () => {
    renderCard(CUSTOMER);
    expect(screen.getByRole("button", { name: /add to wishlist/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add gold ring to cart/i })).toBeInTheDocument();
  });

  it("shows the wishlist and quick-add-to-cart buttons for a signed-out visitor", () => {
    renderCard(null);
    expect(screen.getByRole("button", { name: /add to wishlist/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add gold ring to cart/i })).toBeInTheDocument();
  });

  it("hides the wishlist and quick-add-to-cart buttons for an admin", () => {
    renderCard(ADMIN);
    expect(screen.queryByRole("button", { name: /add to wishlist/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add gold ring to cart/i })).not.toBeInTheDocument();
  });
});
