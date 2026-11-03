-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT 'JEWELRY',
    "category" TEXT NOT NULL,
    "metalType" TEXT NOT NULL,
    "purity" REAL NOT NULL,
    "weightGrams" REAL NOT NULL,
    "makingChargeCents" INTEGER NOT NULL DEFAULT 0,
    "currentPriceCents" INTEGER NOT NULL DEFAULT 0,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("category", "createdAt", "currentPriceCents", "description", "id", "imageUrl", "isActive", "makingChargeCents", "metalType", "name", "purity", "sku", "stockQuantity", "updatedAt", "weightGrams") SELECT "category", "createdAt", "currentPriceCents", "description", "id", "imageUrl", "isActive", "makingChargeCents", "metalType", "name", "purity", "sku", "stockQuantity", "updatedAt", "weightGrams" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
