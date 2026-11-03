import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "../../context/AuthContext";
import type { User } from "../../types";
import { ProtectedRoute } from "./ProtectedRoute";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

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
const SUPER_ADMIN: User = { ...CUSTOMER, id: "u3", name: "Super Admin User", role: "SUPER_ADMIN" };

function renderGuarded(user: User | null, props: Partial<React.ComponentProps<typeof ProtectedRoute>> = {}) {
  mockedUseAuth.mockReturnValue({
    user,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={["/guarded"]}>
      <Routes>
        <Route
          path="/guarded"
          element={
            <ProtectedRoute {...props}>
              <p>Protected content</p>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

// The cart/wishlist/order-history routes use excludeRole="ADMIN" (cart also
// requireAuth={false}) since those are shopping features not relevant to an
// admin's own account - see the identical note on ProductCard.tsx.
describe("ProtectedRoute", () => {
  it("redirects to login when signed out and auth is required", () => {
    renderGuarded(null);
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("renders children for a signed-in customer with no role restriction", () => {
    renderGuarded(CUSTOMER);
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("redirects home when excludeRole matches the signed-in user's role", () => {
    renderGuarded(ADMIN, { excludeRole: "ADMIN" });
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("renders children when excludeRole doesn't match", () => {
    renderGuarded(CUSTOMER, { excludeRole: "ADMIN" });
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("with requireAuth=false, renders children for a signed-out visitor", () => {
    renderGuarded(null, { requireAuth: false, excludeRole: "ADMIN" });
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("with requireAuth=false, still redirects home for an excluded role", () => {
    renderGuarded(ADMIN, { requireAuth: false, excludeRole: "ADMIN" });
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  // SUPER_ADMIN has every ADMIN permission (see CLAUDE.md's SUPER_ADMIN
  // bullet) - role="ADMIN" (used to gate /admin/*) and excludeRole="ADMIN"
  // (used to gate the shopping-only routes) both need to treat it the same
  // way a plain ADMIN is treated, via the same hierarchy the server's
  // authorize() applies.
  it("renders children for a plain admin when role=\"ADMIN\" is required", () => {
    renderGuarded(ADMIN, { role: "ADMIN" });
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("also renders children for the super admin when role=\"ADMIN\" is required", () => {
    renderGuarded(SUPER_ADMIN, { role: "ADMIN" });
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("redirects home for a customer when role=\"ADMIN\" is required", () => {
    renderGuarded(CUSTOMER, { role: "ADMIN" });
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("redirects the super admin away from an excludeRole=\"ADMIN\" route, same as a plain admin", () => {
    renderGuarded(SUPER_ADMIN, { excludeRole: "ADMIN" });
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });
});
