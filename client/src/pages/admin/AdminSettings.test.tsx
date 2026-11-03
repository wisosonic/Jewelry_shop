import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fetchLatestMetalPrices, fetchSettings, updateSettings } from "../../api/admin";
import { useToast } from "../../context/ToastContext";
import type { Settings } from "../../types";
import { AdminSettings } from "./AdminSettings";

vi.mock("../../api/admin", () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
  fetchLatestMetalPrices: vi.fn(),
  refreshMetalPrices: vi.fn(),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: vi.fn() }));

const mockedFetchSettings = vi.mocked(fetchSettings);
const mockedUpdateSettings = vi.mocked(updateSettings);
const mockedFetchLatestMetalPrices = vi.mocked(fetchLatestMetalPrices);
const mockedUseToast = vi.mocked(useToast);

const SETTINGS: Settings = {
  id: 1,
  commissionSellingGoldCentsPerTroyOunce: 5000,
  commissionSellingSilverCentsPerTroyOunce: 5000,
  commissionBuyingGoldCentsPerTroyOunce: -3000,
  commissionBuyingSilverCentsPerTroyOunce: -3000,
  currency: "USD",
  usdToLbpRate: 89500,
  lowStockThreshold: 5,
  universalOtpCode: null,
  otpVerificationEnabled: true,
  metalPriceScheduleEnabled: true,
  metalPriceRefreshFrequencyMinutes: 60,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const LATEST_PRICES = {
  gold: null,
  silver: null,
  commissionSellingGoldCentsPerTroyOunce: 0,
  commissionSellingSilverCentsPerTroyOunce: 0,
  commissionBuyingGoldCentsPerTroyOunce: 0,
  commissionBuyingSilverCentsPerTroyOunce: 0,
  usdToLbpRate: 89500,
  lastFetchedAt: null,
} as never;

function renderPage() {
  return render(<AdminSettings />);
}

describe("AdminSettings", () => {
  it("shows an error with retry when settings fail to load, and recovers on retry", async () => {
    mockedUseToast.mockReturnValue({ showToast: vi.fn() });
    mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
    mockedFetchSettings.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/couldn't load settings/i)).toBeInTheDocument();

    mockedFetchSettings.mockResolvedValueOnce(SETTINGS);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("heading", { name: /store settings/i })).toBeInTheDocument();
  });

  describe("metal prices section", () => {
    it("shows the current schedule state and saves a toggle immediately, with no separate Save button", async () => {
      mockedUseToast.mockReturnValue({ showToast: vi.fn() });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue(SETTINGS);
      mockedUpdateSettings.mockResolvedValue({ ...SETTINGS, metalPriceScheduleEnabled: false });
      const user = userEvent.setup();
      renderPage();

      const toggle = await screen.findByRole("switch", { name: /automatically refresh prices on a schedule/i });
      expect(toggle).toBeChecked();

      await user.click(toggle);

      expect(mockedUpdateSettings).toHaveBeenCalledWith({ metalPriceScheduleEnabled: false });
      expect(await screen.findByRole("switch", { name: /automatically refresh prices on a schedule/i })).not.toBeChecked();
    });

    it("reverts the toggle if saving the schedule change fails", async () => {
      mockedUseToast.mockReturnValue({ showToast: vi.fn() });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue(SETTINGS);
      mockedUpdateSettings.mockRejectedValueOnce(new Error("network error"));
      const user = userEvent.setup();
      renderPage();

      const toggle = await screen.findByRole("switch", { name: /automatically refresh prices on a schedule/i });
      expect(toggle).toBeChecked();

      await user.click(toggle);

      expect(await screen.findByRole("switch", { name: /automatically refresh prices on a schedule/i })).toBeChecked();
    });

    it("does not gate the manual refresh button on the schedule setting being off", async () => {
      mockedUseToast.mockReturnValue({ showToast: vi.fn() });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue({ ...SETTINGS, metalPriceScheduleEnabled: false });
      renderPage();

      const refreshButton = await screen.findByRole("button", { name: /refresh now/i });
      expect(refreshButton).not.toBeDisabled();
    });

    it("shows the current refresh frequency and saves a valid change", async () => {
      mockedUseToast.mockReturnValue({ showToast: vi.fn() });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue(SETTINGS);
      mockedUpdateSettings.mockResolvedValue({ ...SETTINGS, metalPriceRefreshFrequencyMinutes: 30 });
      const user = userEvent.setup();
      renderPage();

      const frequencyInput = await screen.findByLabelText(/refresh frequency/i);
      expect(frequencyInput).toHaveValue("60");

      await user.clear(frequencyInput);
      await user.type(frequencyInput, "30");
      await user.click(screen.getByRole("button", { name: /^save$/i }));

      expect(mockedUpdateSettings).toHaveBeenCalledWith({ metalPriceRefreshFrequencyMinutes: 30 });
      expect(await screen.findByDisplayValue("30")).toBeInTheDocument();
    });

    it("rejects a refresh frequency outside 1-1440 without calling the API", async () => {
      mockedUseToast.mockReturnValue({ showToast: vi.fn() });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue(SETTINGS);
      const user = userEvent.setup();
      renderPage();

      const frequencyInput = await screen.findByLabelText(/refresh frequency/i);
      await user.clear(frequencyInput);
      await user.type(frequencyInput, "1441");
      await user.click(screen.getByRole("button", { name: /^save$/i }));

      expect(await screen.findByText(/must be a whole number between 1 and 1440/i)).toBeInTheDocument();
      expect(mockedUpdateSettings).not.toHaveBeenCalled();
    });
  });

  describe("OTP verification section", () => {
    it("shows the current otpVerificationEnabled value and saves a toggle immediately, with a confirmation toast and no separate Save button", async () => {
      const showToast = vi.fn();
      mockedUseToast.mockReturnValue({ showToast });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue(SETTINGS);
      mockedUpdateSettings.mockResolvedValue({ ...SETTINGS, otpVerificationEnabled: false });
      const user = userEvent.setup();
      renderPage();

      const toggle = await screen.findByRole("switch", { name: /require otp verification/i });
      expect(toggle).toBeChecked();

      await user.click(toggle);

      expect(mockedUpdateSettings).toHaveBeenCalledWith({ otpVerificationEnabled: false });
      expect(await screen.findByRole("switch", { name: /require otp verification/i })).not.toBeChecked();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    });

    it("reverts the toggle and shows an error toast if saving the change fails", async () => {
      const showToast = vi.fn();
      mockedUseToast.mockReturnValue({ showToast });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue(SETTINGS);
      mockedUpdateSettings.mockRejectedValueOnce(new Error("network error"));
      const user = userEvent.setup();
      renderPage();

      const toggle = await screen.findByRole("switch", { name: /require otp verification/i });
      expect(toggle).toBeChecked();

      await user.click(toggle);

      expect(await screen.findByRole("switch", { name: /require otp verification/i })).toBeChecked();
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"), "error");
    });

    it("saves the universal bypass code on its own, separate from the OTP-requirement toggle", async () => {
      mockedUseToast.mockReturnValue({ showToast: vi.fn() });
      mockedFetchLatestMetalPrices.mockResolvedValue(LATEST_PRICES);
      mockedFetchSettings.mockResolvedValue(SETTINGS);
      mockedUpdateSettings.mockResolvedValue({ ...SETTINGS, universalOtpCode: "12345" });
      const user = userEvent.setup();
      renderPage();

      const codeInput = await screen.findByLabelText(/universal code/i);
      await user.type(codeInput, "12345");
      await user.click(screen.getByRole("button", { name: /save universal code/i }));

      expect(mockedUpdateSettings).toHaveBeenCalledWith({ universalOtpCode: "12345" });
    });
  });
});
