import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { fetchRevenueSummary } from "../../api/admin";
import type { RevenueSummary } from "../../types";
import { AdminRevenue } from "./AdminRevenue";

vi.mock("../../api/admin", () => ({ fetchRevenueSummary: vi.fn() }));

const mockedFetchRevenueSummary = vi.mocked(fetchRevenueSummary);

const SUMMARY: RevenueSummary = {
  totalEarnedRevenueCents: 150000,
  totalPendingRevenueCents: 25000,
  revenueByCategory: [
    { productType: "JEWELRY", category: "RING", earnedCents: 100000, pendingCents: 10000 },
    { productType: "BULLION", category: "BAR", earnedCents: 50000, pendingCents: 15000 },
  ],
  trend: [
    { period: "2026-08", earnedCents: 70000, pendingCents: 10000 },
    { period: "2026-09", earnedCents: 80000, pendingCents: 15000 },
  ],
  filteredRange: null,
};

function renderRevenue() {
  return render(
    <MemoryRouter>
      <AdminRevenue />
    </MemoryRouter>
  );
}

// Coverage here is deliberately shallow on the chart itself (recharts'
// internal SVG rendering isn't this app's logic to test) and focused on the
// data this page is actually responsible for computing/showing: the
// earned/pending totals and the category table - see CLAUDE.md's revenue
// module bullet for the earned/pending definition this renders.
describe("AdminRevenue", () => {
  it("shows a loading state, then the earned/pending totals and category breakdown", async () => {
    mockedFetchRevenueSummary.mockResolvedValue(SUMMARY);
    renderRevenue();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    expect(await screen.findByText("$1,500.00")).toBeInTheDocument(); // earned
    expect(screen.getByText("$250.00")).toBeInTheDocument(); // pending

    expect(screen.getByText("RING")).toBeInTheDocument();
    expect(screen.getByText("BAR")).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument(); // RING earned
    expect(screen.getByText("$150.00")).toBeInTheDocument(); // BAR pending

    // The chart section renders without throwing (ResponsiveContainer needs
    // the ResizeObserver stub from test/setup.ts).
    expect(screen.getByTestId("revenue-trend-chart")).toBeInTheDocument();
  });

  it("shows an empty state when there's no revenue yet", async () => {
    mockedFetchRevenueSummary.mockResolvedValue({
      totalEarnedRevenueCents: 0,
      totalPendingRevenueCents: 0,
      revenueByCategory: [],
      trend: [],
      filteredRange: null,
    });
    renderRevenue();

    expect(await screen.findByText(/no revenue yet/i)).toBeInTheDocument();
  });

  it("shows an error with retry when the load fails, and recovers on retry", async () => {
    mockedFetchRevenueSummary.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderRevenue();

    expect(await screen.findByText(/couldn't load revenue data/i)).toBeInTheDocument();

    mockedFetchRevenueSummary.mockResolvedValueOnce(SUMMARY);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("$1,500.00")).toBeInTheDocument();
  });

  it("links the Earned card's 'View orders' button to the admin orders list filtered to EARNED", async () => {
    mockedFetchRevenueSummary.mockResolvedValue(SUMMARY);
    renderRevenue();

    const earnedCard = (await screen.findByText("Earned revenue")).closest("div")!;
    const link = within(earnedCard).getByRole("link", { name: /view orders/i });
    expect(link).toHaveAttribute("href", "/admin/orders?status=EARNED");
  });

  it("links the Pending card's 'View orders' button to the admin orders list filtered to PENDING", async () => {
    mockedFetchRevenueSummary.mockResolvedValue(SUMMARY);
    renderRevenue();

    const pendingCard = (await screen.findByText("Pending revenue")).closest("div")!;
    const link = within(pendingCard).getByRole("link", { name: /view orders/i });
    expect(link).toHaveAttribute("href", "/admin/orders?status=PENDING");
  });

  it("loads with no date-range filter applied by default, and shows no 'Clear filter' button or 'Showing' text", async () => {
    mockedFetchRevenueSummary.mockResolvedValue(SUMMARY);
    renderRevenue();
    await screen.findByText("Earned revenue");

    expect(mockedFetchRevenueSummary).toHaveBeenCalledWith(undefined, undefined);
    expect(screen.queryByRole("button", { name: /clear filter/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/showing:/i)).not.toBeInTheDocument();
  });

  it("disables Apply until both From and To are filled in, and doesn't re-fetch just from typing a date", async () => {
    mockedFetchRevenueSummary.mockResolvedValue(SUMMARY);
    const user = userEvent.setup();
    renderRevenue();
    await screen.findByText("Earned revenue");
    mockedFetchRevenueSummary.mockClear();

    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/from date/i), "2024-03-01");
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
    expect(mockedFetchRevenueSummary).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/to date/i), "2024-03-31");
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeEnabled();
    expect(mockedFetchRevenueSummary).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(mockedFetchRevenueSummary).toHaveBeenCalledWith(undefined, { fromDate: "2024-03-01", toDate: "2024-03-31" });
  });

  it("rejects an end date before the start date client-side, without fetching", async () => {
    mockedFetchRevenueSummary.mockResolvedValue(SUMMARY);
    const user = userEvent.setup();
    renderRevenue();
    await screen.findByText("Earned revenue");
    mockedFetchRevenueSummary.mockClear();

    await user.type(screen.getByLabelText(/from date/i), "2024-03-31");
    await user.type(screen.getByLabelText(/to date/i), "2024-03-01");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/end date can't be before the start date/i)).toBeInTheDocument();
    expect(mockedFetchRevenueSummary).not.toHaveBeenCalled();
  });

  it("shows the filtered date range above the chart once applied, and lets the admin clear it back to the default trend", async () => {
    mockedFetchRevenueSummary.mockResolvedValue({
      ...SUMMARY,
      trend: [{ period: "2024-03", earnedCents: 5000, pendingCents: 0 }],
      filteredRange: { fromDate: "2024-03-01", toDate: "2024-03-31" },
    });
    const user = userEvent.setup();
    renderRevenue();
    await screen.findByText("Earned revenue");

    await user.type(screen.getByLabelText(/from date/i), "2024-03-01");
    await user.type(screen.getByLabelText(/to date/i), "2024-03-31");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/showing:/i)).toBeInTheDocument();
    expect(screen.getByText("Mar 1, 2024 – Mar 31, 2024")).toBeInTheDocument();

    mockedFetchRevenueSummary.mockResolvedValue(SUMMARY);
    await user.click(screen.getByRole("button", { name: /clear filter/i }));

    expect(mockedFetchRevenueSummary).toHaveBeenLastCalledWith(undefined, undefined);
    await screen.findByText("Earned revenue");
    expect(screen.queryByText(/showing:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear filter/i })).not.toBeInTheDocument();
  });
});
