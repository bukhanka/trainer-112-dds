import { collectHealth } from "@/lib/admin/health";
import { SERVICE_KEYS, SERVICE_LABELS } from "@/lib/admin/services";
import { collectServicesStatus, type ServicesStatus } from "@/lib/admin/services-status";
import { requireUser } from "@/lib/auth/session";
import { formatTime } from "@/lib/format";
import { HealthPanel } from "./HealthPanel";
import { ServicesPanel } from "./ServicesPanel";

export default async function AdminHome() {
  await requireUser(["ADMIN"]); // the layout's check does not guard the page's own data (partial rendering)
  const [health, services] = await Promise.all([collectHealth(), collectServicesStatus()]);
  return (
    <div className="flex flex-col gap-6">
      <StoppedBanner services={services} />
      <HealthPanel initial={health} />
      <ServicesPanel initial={services} />
    </div>
  );
}

function StoppedBanner({ services }: { services: ServicesStatus }) {
  const stopped = SERVICE_KEYS.filter((k) => !services[k].on);
  if (!stopped.length) return null;
  return (
    <div role="status" className="rounded border border-amber-400 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      Остановлено администратором:{" "}
      {stopped
        .map((k) => {
          const s = services[k];
          return `${SERVICE_LABELS[k]}${s.by ? ` (${s.by}${s.at ? `, ${formatTime(s.at)}` : ""})` : ""}${s.until ? ` — запустится само в ${formatTime(s.until)}` : ""}`;
        })
        .join("; ")}
      . Запустить — в разделе «Службы» ниже.
    </div>
  );
}
