import { PrismaClient } from "@prisma/client";

/** Shared Prisma client instance used for all database access in the app. */
export const prisma = new PrismaClient();
