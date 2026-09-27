/**
 * Interactive transactions of the ДДС place, in step with the card flow (ensureDdsFlow runs up to 15 s
 * under load). A step takes its advisory lock first and is short itself, but it may queue for a connection
 * or for a row the flow is writing; it waits for that instead of failing after Prisma's default 5 s, and
 * when it still cannot get its turn the user reads why instead of a bare 500.
 */
import { Prisma } from "@prisma/client";

export const DDS_TX = { maxWait: 10_000, timeout: 20_000 };

export const SERVER_BUSY = "Сервер занят и не успел выполнить действие — повторите через пару секунд";

/** Timed out waiting for a connection (P2024), a transaction (P2028) or a lock / write conflict (P2034). */
export function isBusyError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && ["P2024", "P2028", "P2034"].includes(err.code);
}
