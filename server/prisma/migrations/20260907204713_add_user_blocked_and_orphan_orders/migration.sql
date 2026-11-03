-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subtotalCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "shippingAddress" TEXT,
    "paymentProvider" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'DEFERRED',
    "paymentReference" TEXT,
    "paymentMethod" TEXT,
    "paymentCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("createdAt", "currency", "id", "paymentCurrency", "paymentMethod", "paymentProvider", "paymentReference", "paymentStatus", "shippingAddress", "status", "subtotalCents", "totalCents", "updatedAt", "userId") SELECT "createdAt", "currency", "id", "paymentCurrency", "paymentMethod", "paymentProvider", "paymentReference", "paymentStatus", "shippingAddress", "status", "subtotalCents", "totalCents", "updatedAt", "userId" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE INDEX "Order_userId_idx" ON "Order"("userId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "deletionWarningSentAt" DATETIME,
    "adminNotes" TEXT,
    "notificationMessagingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("address", "adminNotes", "createdAt", "deletionWarningSentAt", "email", "id", "isVerified", "lastLoginAt", "name", "notificationMessagingEnabled", "passwordHash", "phone", "role", "updatedAt") SELECT "address", "adminNotes", "createdAt", "deletionWarningSentAt", "email", "id", "isVerified", "lastLoginAt", "name", "notificationMessagingEnabled", "passwordHash", "phone", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
