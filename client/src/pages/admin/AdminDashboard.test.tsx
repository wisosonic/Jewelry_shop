import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { fetchDashboardSummary } from "../../api/admin";
import type { DashboardSummary } from "../../types";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../../api/admin", () => ({ fetchDashboardSummary: vi.fn() }));
// MetalPricesPanel fetches its own data (GET /metals/latest) independently
// of AdminDashboard's own load - shallow-rendered so this test only has to
// account for one network call, not two.
vi.mock("../../components/metals/MetalPricesPanel", () => ({
  MetalPricesPanel: () => <div>Metal prices</div>,
}));

const mockedFetchDashboardSummary = vi.mocked(fetchDashboardSummary);

const SUMMARY: DashboardSummary = {
  userCount: 42,
  productCount: 14,
  totalRevenueCents: 123456,
  ordersByStatus: { PENDING: 3, CONFIRMED: 1 },
  recentOrders: [],
  lowStockProducts: [],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>
  );
}

describe("AdminDashboard", () => {
  it("shows a loading state, then the headline stats once the summary loads", async () => {
    mockedFetchDashboardSummary.mockResolvedValue(SUMMARY);
    renderDashboard();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(await screen.findByText("$1,234.56")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("shows an error with a retry affordance when the load fails, and recovers on retry", async () => {
    mockedFetchDashboardSummary.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByText(/couldn't load the dashboard/i)).toBeInTheDocument();

    mockedFetchDashboardSummary.mockResolvedValueOnce(SUMMARY);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("$1,234.56")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load the dashboard/i)).not.toBeInTheDocument();
  });

  it("shows the low-stock alert only when there are low-stock products", async () => {
    mockedFetchDashboardSummary.mockResolvedValue({
      ...SUMMARY,
      lowStockProducts: [
        {
          id: "p1",
          sku: "RING-1",
          name: "Low Ring",
          description: "d",
          productType: "JEWELRY",
          category: "RING",
          metalType: "GOLD",
          purity: 0.75,
          weightGrams: 2,
          makingChargeCents: 0,
          currentPriceCents: 1000,
          stockQuantity: 1,
          isActive: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    renderDashboard();

    expect(await screen.findByText(/low stock alert/i)).toBeInTheDocument();
    expect(screen.getByText(/Low Ring/)).toBeInTheDocument();
  });
});
