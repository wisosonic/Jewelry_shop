import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "../context/AuthContext";
import type { User } from "../types";
import { Login } from "./Login";

// `useAuth` is mocked at the module level (not a real `<AuthProvider>`) so
// each test controls exactly what `login()` does/returns, without needing
// to also mock the underlying `api.post("/auth/login")` call and cookie/
// token plumbing `AuthContext` itself is responsible for - this test is
// about `Login.tsx`'s own behavior (form state, error display, redirect),
// which is orthogonal to how `useAuth` is implemented.
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

function renderLogin(initialEntries: string[] = ["/login"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>Home page</p>} />
        <Route path="/admin" element={<p>Admin page</p>} />
        <Route path="/checkout" element={<p>Checkout page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

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

describe("Login", () => {
  it("logs in and redirects a customer home", async () => {
    const login = vi.fn().mockResolvedValue(CUSTOMER);
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login,
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email or phone number/i), "shopper@test.com");
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(login).toHaveBeenCalledWith("shopper@test.com", "Password123!");
    await waitFor(() => expect(screen.getByText("Home page")).toBeInTheDocument());
  });

  it("redirects an admin to /admin instead of home", async () => {
    const login = vi.fn().mockResolvedValue({ ...CUSTOMER, role: "ADMIN" });
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login,
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/email or phone number/i), "admin@test.com");
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText("Admin page")).toBeInTheDocument());
  });

  it("redirects back to the originally-requested page after login", async () => {
    const login = vi.fn().mockResolvedValue(CUSTOMER);
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login,
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[{ pathname: "/login", state: { from: { pathname: "/checkout" } } }]}
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/checkout" element={<p>Checkout page</p>} />
        </Routes>
      </MemoryRouter>
    );
    await user.type(screen.getByLabelText(/email or phone number/i), "shopper@test.com");
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText("Checkout page")).toBeInTheDocument());
  });

  it("shows an error and re-enables the form on invalid credentials, without navigating away", async () => {
    const login = vi.fn().mockRejectedValue(new Error("401"));
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login,
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/email or phone number/i), "shopper@test.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid email or password/i);
    expect(screen.queryByText("Home page")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });
});
