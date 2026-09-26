export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/admin/scheduler");
    startScheduler();
  }
}

/** Server errors go to the journal as crash reports for the administrator. */
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { audit } = await import("./lib/audit");
  const message = error instanceof Error ? error.message : String(error);
  await audit({ action: "system.error", actor: "system", entity: "route", entityId: `${request.method} ${request.path}`, after: { message: message.slice(0, 1000) } });
}
