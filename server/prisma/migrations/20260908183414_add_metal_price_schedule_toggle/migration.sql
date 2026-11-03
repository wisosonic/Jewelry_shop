-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "commissionSellingCentsPerTroyOunce" INTEGER NOT NULL DEFAULT 5000,
    "commissionBuyingCentsPerTroyOunce" INTEGER NOT NULL DEFAULT -3000,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "usdToLbpRate" REAL NOT NULL DEFAULT 89500,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "universalOtpCode" TEXT,
    "universalOtpFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "universalOtpLockedUntil" DATETIME,
    "otpVerificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metalPriceScheduleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("commissionBuyingCentsPerTroyOunce", "commissionSellingCentsPerTroyOunce", "currency", "id", "lowStockThreshold", "otpVerificationEnabled", "universalOtpCode", "universalOtpFailedAttempts", "universalOtpLockedUntil", "updatedAt", "usdToLbpRate") SELECT "commissionBuyingCentsPerTroyOunce", "commissionSellingCentsPerTroyOunce", "currency", "id", "lowStockThreshold", "otpVerificationEnabled", "universalOtpCode", "universalOtpFailedAttempts", "universalOtpLockedUntil", "updatedAt", "usdToLbpRate" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
