-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "commissionSellingGoldCentsPerTroyOunce" INTEGER NOT NULL DEFAULT 5000,
    "commissionSellingSilverCentsPerTroyOunce" INTEGER NOT NULL DEFAULT 5000,
    "commissionBuyingGoldCentsPerTroyOunce" INTEGER NOT NULL DEFAULT -3000,
    "commissionBuyingSilverCentsPerTroyOunce" INTEGER NOT NULL DEFAULT -3000,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "usdToLbpRate" REAL NOT NULL DEFAULT 89500,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "universalOtpCode" TEXT,
    "universalOtpFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "universalOtpLockedUntil" DATETIME,
    "otpVerificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metalPriceScheduleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metalPriceRefreshFrequencyMinutes" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);
-- Carry the existing single rate forward into BOTH metals' columns (rather
-- than resetting to the schema default), so an admin's currently-configured
-- commission keeps applying identically to gold and silver immediately
-- after this migration - they can then differentiate the two going forward.
INSERT INTO "new_Settings" ("id", "commissionSellingGoldCentsPerTroyOunce", "commissionSellingSilverCentsPerTroyOunce", "commissionBuyingGoldCentsPerTroyOunce", "commissionBuyingSilverCentsPerTroyOunce", "currency", "usdToLbpRate", "lowStockThreshold", "universalOtpCode", "universalOtpFailedAttempts", "universalOtpLockedUntil", "otpVerificationEnabled", "metalPriceScheduleEnabled", "metalPriceRefreshFrequencyMinutes", "updatedAt")
SELECT "id", "commissionSellingCentsPerTroyOunce", "commissionSellingCentsPerTroyOunce", "commissionBuyingCentsPerTroyOunce", "commissionBuyingCentsPerTroyOunce", "currency", "usdToLbpRate", "lowStockThreshold", "universalOtpCode", "universalOtpFailedAttempts", "universalOtpLockedUntil", "otpVerificationEnabled", "metalPriceScheduleEnabled", "metalPriceRefreshFrequencyMinutes", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
