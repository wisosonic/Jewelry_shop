import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDatabase, teardownTestDatabase } from "./helpers/testDb";

let dbPath: string;

// Captures the callback `startMetalsScheduler()` registers with node-cron so
// the test can invoke it directly, rather than actually waiting on a cron
// schedule - there's no existing pattern in this repo for testing a
// scheduler, so this mock is deliberately minimal (just enough to grab the
// function and call it on demand).
let scheduledCallback: (() => Promise<void>) | undefined;
vi.mock("node-cron", () => ({
  default: {
    schedule: (_expression: string, callback: () => Promise<void>) => {
      scheduledCallback = callback;
      return { stop: vi.fn() };
    },
  },
}));

vi.mock("../src/modules/metals/metals.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/metals/metals.service")>();
  return { ...actual, refreshMetalPrices: vi.fn().mockResolvedValue(undefined) };
});

beforeAll(() => {
  dbPath = setupTestDatabase("test-metals-scheduler.db");
});

afterAll(async () => {
  const { prisma } = await import("../src/db/prisma");
  await prisma.$disconnect();
  teardownTestDatabase(dbPath);
});

describe("metals scheduler", () => {
  it("skips both the boot-time fetch and the scheduled tick when metalPriceScheduleEnabled is false, and runs the tick once re-enabled", async () => {
    const { prisma } = await import("../src/db/prisma");
    const metalsService = await import("../src/modules/metals/metals.service");
    const { startMetalsScheduler } = await import("../src/modules/metals/metals.scheduler");
    const refreshMock = vi.mocked(metalsService.refreshMetalPrices);

    await prisma.settings.create({ data: { id: 1, metalPriceScheduleEnabled: false } });

    startMetalsScheduler();
    // Let the boot-time fetch's getSettings().then(...) chain settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refreshMock).not.toHaveBeenCalled();

    expect(scheduledCallback).toBeTypeOf("function");
    await scheduledCallback!();
    expect(refreshMock).not.toHaveBeenCalled();

    await prisma.settings.update({ where: { id: 1 }, data: { metalPriceScheduleEnabled: true } });
    await scheduledCallback!();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("treats a 429 (not due yet) as an expected, silent skip, but logs a genuine failure as an error", async () => {
    const { prisma } = await import("../src/db/prisma");
    const { AppError } = await import("../src/utils/AppError");
    const metalsService = await import("../src/modules/metals/metals.service");
    const refreshMock = vi.mocked(metalsService.refreshMetalPrices);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await prisma.settings.update({ where: { id: 1 }, data: { metalPriceScheduleEnabled: true } });
    expect(scheduledCallback).toBeTypeOf("function");

    refreshMock.mockRejectedValueOnce(AppError.tooManyRequests("Metal prices were refreshed recently."));
    await scheduledCallback!();
    expect(errorSpy).not.toHaveBeenCalled();

    refreshMock.mockRejectedValueOnce(new Error("network error"));
    await scheduledCallback!();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});
