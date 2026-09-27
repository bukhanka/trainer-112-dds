export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/admin/scheduler");
    startScheduler();
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    // Every server process follows the service switches (models, card flow, scheduler) set by the administrator.
    const { startServiceSync } = await import("./lib/admin/services");
    startServiceSync();
    // A start after a crash or a deploy is visible in the system journal; the write never delays the start.
    const { audit } = await import("./lib/audit");
    void audit({
      action: "system.start",
      actor: "system",
      entity: "process",
      entityId: String(process.pid),
      after: { node: process.version, scheduler: process.env.DISABLE_SCHEDULER !== "true", demo: process.env.DEMO_MODE === "true" },
    });
  }
}

/** Server errors go to the journal as crash reports for the administrator. */
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { audit } = await import("./lib/audit");
  const message = error instanceof Error ? error.message : String(error);
  await audit({ action: "system.error", actor: "system", entity: "route", entityId: `${request.method} ${request.path}`, after: { message: message.slice(0, 1000) } });
}
