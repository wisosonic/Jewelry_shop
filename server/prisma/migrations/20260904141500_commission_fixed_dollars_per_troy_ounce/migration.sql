-- Commission fields change unit from cents-per-gram to a fixed cents-per-
-- troy-ounce surcharge (still integer cents, still can be negative). As
-- with the prior commission unit change, existing rows' old per-gram values
-- have no meaningful equivalent in the new per-troy-ounce scheme, so
-- they're backfilled with the new schema defaults / a placeholder rather
-- than converted.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- RedefineTables: Settings
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "commissionSellingCentsPerTroyOunce" INTEGER NOT NULL DEFAULT 5000,
    "commissionBuyingCentsPerTroyOunce" INTEGER NOT NULL DEFAULT -3000,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("id", "commissionSellingCentsPerTroyOunce", "commissionBuyingCentsPerTroyOunce", "currency", "updatedAt")
SELECT "id", 5000, -3000, "currency", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";

-- RedefineTables: OrderItem
CREATE TABLE "new_OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCentsSnapshot" INTEGER NOT NULL,
    "metalPricePerGramCentsSnapshot" INTEGER NOT NULL,
    "commissionCentsPerTroyOunceSnapshot" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("id", "orderId", "productId", "productNameSnapshot", "skuSnapshot", "quantity", "unitPriceCentsSnapshot", "metalPricePerGramCentsSnapshot", "commissionCentsPerTroyOunceSnapshot", "lineTotalCents")
SELECT "id", "orderId", "productId", "productNameSnapshot", "skuSnapshot", "quantity", "unitPriceCentsSnapshot", "metalPricePerGramCentsSnapshot", 5000, "lineTotalCents" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
