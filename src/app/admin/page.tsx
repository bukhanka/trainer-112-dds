import Link from "next/link";
import { collectHealth } from "@/lib/admin/health";
import { lastIntegrity, type IntegrityReport } from "@/lib/admin/integrity";
import { SERVICE_KEYS, SERVICE_LABELS } from "@/lib/admin/services";
import { collectServicesStatus, type ServicesStatus } from "@/lib/admin/services-status";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime, formatTime } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { HealthPanel } from "./HealthPanel";
import { IntegrityPanel } from "./IntegrityPanel";
import { ServicesPanel } from "./ServicesPanel";

export default async function AdminHome() {
  await requireUser(["ADMIN"]); // the layout's check does not guard the page's own data (partial rendering)
  const [health, integrity, services, integrityAt] = await Promise.all([
    collectHealth(),
    lastIntegrity(),
    collectServicesStatus(),
    getSetting("integrity.dailyAt", "05:00").catch(() => "05:00"),
  ]);
  return (
    <div className="flex flex-col gap-6">
      {integrity && !integrity.ok && <IntegrityBanner report={integrity} />}
      <StoppedBanner services={services} />
      <HealthPanel initial={health} />
      <ServicesPanel initial={services} />
      <IntegrityPanel initial={integrity} dailyAt={integrityAt} />
    </div>
  );
}

function IntegrityBanner({ report }: { report: IntegrityReport }) {
  const failed = report.checks.filter((c) => !c.ok);
  return (
    <div role="alert" className="rounded border-2 border-arm-late bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="font-semibold">
        Контроль целостности {formatDateTime(report.at)}: {failed.length === 1 ? "найдена проблема" : `найдено проблем — ${failed.length}`}
      </p>
      <ul className="mt-1 list-disc pl-5">
        {failed.map((c) => (
          <li key={c.code}>
            <b>{c.title}:</b> {c.detail}
          </li>
        ))}
      </ul>
      <Link href="#integrity" className="mt-1 inline-block underline">
        Все проверки и повторная проверка ↓
      </Link>
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
