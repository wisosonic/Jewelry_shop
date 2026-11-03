import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLatestMetalPrices } from "../../api/admin";
import { fetchMyNotifications, markNotificationRead } from "../../api/notifications";
import { useAuth } from "../../context/AuthContext";
import { useCartStore } from "../../store/cartStore";
import { useNotificationStore } from "../../store/notificationStore";
import type { Notification, User } from "../../types";
import { Navbar } from "./Navbar";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/notifications", () => ({
  fetchMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));
// Unrelated to the bell - just keep useCurrencyRateSync's fetch from making
// a real (unmocked) network call during these renders.
vi.mock("../../api/admin", () => ({ fetchLatestMetalPrices: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedFetchMyNotifications = vi.mocked(fetchMyNotifications);
const mockedMarkNotificationRead = vi.mocked(markNotificationRead);
const mockedFetchLatestMetalPrices = vi.mocked(fetchLatestMetalPrices);

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

const NOTIFICATION: Notification = {
  id: "n1",
  type: "ORDER_CONFIRMED",
  message: "Your order has been placed.",
  link: "/orders/o1",
  isRead: false,
  createdAt: new Date().toISOString(),
};

function renderNavbar() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Navbar />
    </MemoryRouter>
  );
}

describe("Navbar notification bell", () => {
  beforeEach(() => {
    useCartStore.setState({ lines: [] });
    useNotificationStore.setState({ unreadCount: 0 });
    mockedUseAuth.mockReturnValue({
      user: CUSTOMER,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    mockedFetchLatestMetalPrices.mockResolvedValue({
      gold: null,
      silver: null,
      commissionSellingGoldCentsPerTroyOunce: 0,
      commissionSellingSilverCentsPerTroyOunce: 0,
      commissionBuyingGoldCentsPerTroyOunce: 0,
      commissionBuyingSilverCentsPerTroyOunce: 0,
      usdToLbpRate: 89500,
      lastFetchedAt: null,
    } as never);
  });

  it("is not rendered when signed out", () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    renderNavbar();
    expect(screen.queryByLabelText(/^notifications/i)).not.toBeInTheDocument();
  });

  it("shows the unread badge from the notification store", () => {
    useNotificationStore.setState({ unreadCount: 3 });
    renderNavbar();
    expect(screen.getByLabelText(/notifications \(3 unread\)/i)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("loads and shows the 5 latest notifications on open", async () => {
    mockedFetchMyNotifications.mockResolvedValue({ items: [NOTIFICATION], total: 1, page: 1, pageSize: 5 });
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByLabelText(/^notifications$/i));

    expect(mockedFetchMyNotifications).toHaveBeenCalledWith({ page: 1, pageSize: 5 });
    expect(await screen.findByText("Your order has been placed.")).toBeInTheDocument();
  });

  it("shows an empty state when there are no notifications", async () => {
    mockedFetchMyNotifications.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 });
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByLabelText(/^notifications$/i));
    expect(await screen.findByText(/you have no notifications yet/i)).toBeInTheDocument();
  });

  it("shows an error with retry when the preview fails to load, and recovers on retry", async () => {
    mockedFetchMyNotifications.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByLabelText(/^notifications$/i));
    const dropdown = await screen.findByText(/couldn't load notifications/i);
    expect(dropdown).toBeInTheDocument();

    mockedFetchMyNotifications.mockResolvedValueOnce({ items: [NOTIFICATION], total: 1, page: 1, pageSize: 5 });
    await user.click(within(dropdown.closest("div")!).getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Your order has been placed.")).toBeInTheDocument();
  });

  it("marks an unread notification read and navigates to its link when clicked", async () => {
    useNotificationStore.setState({ unreadCount: 1 });
    mockedFetchMyNotifications.mockResolvedValue({ items: [NOTIFICATION], total: 1, page: 1, pageSize: 5 });
    mockedMarkNotificationRead.mockResolvedValue({ ...NOTIFICATION, isRead: true });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Navbar />} />
          <Route path="/orders/:id" element={<p>Order detail page</p>} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByLabelText(/notifications \(1 unread\)/i));
    await user.click(await screen.findByText("Your order has been placed."));

    expect(mockedMarkNotificationRead).toHaveBeenCalledWith("n1");
    expect(await screen.findByText("Order detail page")).toBeInTheDocument();
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});

describe("Navbar account menu", () => {
  beforeEach(() => {
    mockedFetchLatestMetalPrices.mockResolvedValue({
      gold: null,
      silver: null,
      commissionSellingGoldCentsPerTroyOunce: 0,
      commissionSellingSilverCentsPerTroyOunce: 0,
      commissionBuyingGoldCentsPerTroyOunce: 0,
      commissionBuyingSilverCentsPerTroyOunce: 0,
      usdToLbpRate: 89500,
      lastFetchedAt: null,
    } as never);
  });

  it("shows order history and wishlist links for a customer", async () => {
    mockedUseAuth.mockReturnValue({
      user: CUSTOMER,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole("button", { name: /shopper/i }));
    expect(screen.getByRole("link", { name: /order history/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /wishlist/i })).toBeInTheDocument();
  });

  it("hides order history and wishlist links for an admin - shopping features, not relevant to an admin's own account", async () => {
    mockedUseAuth.mockReturnValue({
      user: ADMIN,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole("button", { name: /admin user/i }));
    expect(screen.queryByRole("link", { name: /order history/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /wishlist/i })).not.toBeInTheDocument();
    // The admin dashboard link is still there.
    expect(screen.getByRole("link", { name: /^admin$/i })).toBeInTheDocument();
  });
});

describe("Navbar cart link", () => {
  beforeEach(() => {
    mockedFetchLatestMetalPrices.mockResolvedValue({
      gold: null,
      silver: null,
      commissionSellingGoldCentsPerTroyOunce: 0,
      commissionSellingSilverCentsPerTroyOunce: 0,
      commissionBuyingGoldCentsPerTroyOunce: 0,
      commissionBuyingSilverCentsPerTroyOunce: 0,
      usdToLbpRate: 89500,
      lastFetchedAt: null,
    } as never);
  });

  it("shows the cart link for a signed-in customer", () => {
    mockedUseAuth.mockReturnValue({
      user: CUSTOMER,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    renderNavbar();
    expect(screen.getByRole("link", { name: /cart/i })).toBeInTheDocument();
  });

  it("shows the cart link for a signed-out visitor - clicking it still prompts sign-in", () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    renderNavbar();
    expect(screen.getByRole("link", { name: /cart/i })).toBeInTheDocument();
  });

  it("hides the cart link for a signed-in admin - shopping features aren't relevant to an admin's own account", () => {
    mockedUseAuth.mockReturnValue({
      user: ADMIN,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    renderNavbar();
    expect(screen.queryByRole("link", { name: /cart/i })).not.toBeInTheDocument();
  });
});
