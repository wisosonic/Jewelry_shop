import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "../context/AuthContext";
import type { User } from "../types";
import { Register } from "./Register";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

const BASE_USER: User = {
  id: "u1",
  email: "shopper@test.com",
  name: "Shopper",
  role: "CUSTOMER",
  phone: "+1-555-0001",
  address: null,
  isVerified: false,
  isBlocked: false,
  createdAt: "2024-01-01T00:00:00.000Z",
};

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/verify-otp" element={<p>Verify OTP page</p>} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), "New Shopper");
  await user.type(screen.getByLabelText(/phone number/i), "+1-555-0001");
  await user.type(screen.getByLabelText(/^password/i), "Password123!");
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

// registerUser()'s OTP-bypass behavior (Settings.otpVerificationEnabled)
// means the returned user can already be verified - see the identical note
// on AdminSettings.tsx's "OTP verification" section.
describe("Register", () => {
  it("sends the shopper to verify their phone when the account comes back unverified (OTP required)", async () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn().mockResolvedValue({ ...BASE_USER, isVerified: false }),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    const user = userEvent.setup();
    renderRegister();

    await fillAndSubmit(user);

    expect(await screen.findByText("Verify OTP page")).toBeInTheDocument();
  });

  it("skips straight home when the account comes back already verified (OTP verification disabled store-wide)", async () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn().mockResolvedValue({ ...BASE_USER, isVerified: true }),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    const user = userEvent.setup();
    renderRegister();

    await fillAndSubmit(user);

    expect(await screen.findByText("Home page")).toBeInTheDocument();
  });
});
