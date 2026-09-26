import { Suspense } from "react";
import { DdsShell } from "@/components/dds/DdsShell";
import { requireUser } from "@/lib/auth/session";

// Full-screen workstation, styled after the customer's system; no cabinet frame.
export default async function WorkstationLayout({ children }: LayoutProps<"/dds">) {
  await requireUser(["STUDENT", "TEACHER", "ADMIN"]);
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={<div className="flex flex-1 items-center justify-center bg-arm-feed text-white">Загрузка рабочего места…</div>}>
        <DdsShell>{children}</DdsShell>
      </Suspense>
    </div>
  );
}
