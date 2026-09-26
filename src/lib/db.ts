import { PrismaClient } from "@prisma/client";

// One client per process; in dev the module is re-evaluated on every change.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db = globalForDb.db ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
