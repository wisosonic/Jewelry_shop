import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fetchSettings, updateSettings } from "../../api/admin";
import { useToast } from "../../context/ToastContext";
import type { Settings } from "../../types";
import { AdminCommission } from "./AdminCommission";

vi.mock("../../api/admin", () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: vi.fn() }));

const mockedFetchSettings = vi.mocked(fetchSettings);
const mockedUpdateSettings = vi.mocked(updateSettings);
const mockedUseToast = vi.mocked(useToast);

const SETTINGS: Settings = {
  id: 1,
  commissionSellingGoldCentsPerTroyOunce: 5000,
  commissionSellingSilverCentsPerTroyOunce: 4000,
  commissionBuyingGoldCentsPerTroyOunce: -3000,
  commissionBuyingSilverCentsPerTroyOunce: -2000,
  currency: "USD",
  usdToLbpRate: 89500,
  lowStockThreshold: 5,
  universalOtpCode: null,
  otpVerificationEnabled: true,
  metalPriceScheduleEnabled: true,
  metalPriceRefreshFrequencyMinutes: 60,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderPage() {
  return render(<AdminCommission />);
}

// Commission used to be a section inside AdminSettings.tsx - it's now its
// own dedicated page/route (/admin/commission), still backed by the same
// Settings row, so it fetches/updates through the same fetchSettings()/
// updateSettings() wrappers as before - see CLAUDE.md's commission bullet.
// Commission is also now split by metal type (gold vs. silver), each with
// its own selling/buying rate - four independent fields saved together.
describe("AdminCommission", () => {
  it("shows an error with retry when settings fail to load, and recovers on retry", async () => {
    mockedUseToast.mockReturnValue({ showToast: vi.fn() });
    mockedFetchSettings.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/couldn't load commission settings/i)).toBeInTheDocument();

    mockedFetchSettings.mockResolvedValueOnce(SETTINGS);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("heading", { name: /^commission$/i })).toBeInTheDocument();
  });

  it("shows gold and silver's current commission separately", async () => {
    mockedUseToast.mockReturnValue({ showToast: vi.fn() });
    mockedFetchSettings.mockResolvedValue(SETTINGS);
    renderPage();

    expect(await screen.findByLabelText(/gold selling commission/i)).toHaveValue("50");
    expect(screen.getByLabelText(/gold buying commission/i)).toHaveValue("-30");
    expect(screen.getByLabelText(/silver selling commission/i)).toHaveValue("40");
    expect(screen.getByLabelText(/silver buying commission/i)).toHaveValue("-20");
  });

  it("saves all four commission values together, in cents", async () => {
    mockedUseToast.mockReturnValue({ showToast: vi.fn() });
    mockedFetchSettings.mockResolvedValue(SETTINGS);
    mockedUpdateSettings.mockResolvedValue({ ...SETTINGS, commissionSellingGoldCentsPerTroyOunce: 6000 });
    const user = userEvent.setup();
    renderPage();

    const goldSellInput = await screen.findByLabelText(/gold selling commission/i);
    await user.clear(goldSellInput);
    await user.type(goldSellInput, "60");
    await user.click(screen.getByRole("button", { name: /save commission/i }));

    expect(mockedUpdateSettings).toHaveBeenCalledWith({
      commissionSellingGoldCentsPerTroyOunce: 6000,
      commissionBuyingGoldCentsPerTroyOunce: -3000,
      commissionSellingSilverCentsPerTroyOunce: 4000,
      commissionBuyingSilverCentsPerTroyOunce: -2000,
    });
  });

  it("rejects a commission value outside the +/-$5,000 bound, on any of the four fields, without calling the API", async () => {
    mockedUseToast.mockReturnValue({ showToast: vi.fn() });
    mockedFetchSettings.mockResolvedValue(SETTINGS);
    const user = userEvent.setup();
    renderPage();

    const silverBuyInput = await screen.findByLabelText(/silver buying commission/i);
    await user.clear(silverBuyInput);
    await user.type(silverBuyInput, "-5001");
    await user.click(screen.getByRole("button", { name: /save commission/i }));

    expect(await screen.findByText("Commission must be between $-5,000 and $5,000 per troy ounce.")).toBeInTheDocument();
    expect(mockedUpdateSettings).not.toHaveBeenCalled();
  });
});
