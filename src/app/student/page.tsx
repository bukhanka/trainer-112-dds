import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { MyTasksSection } from "./MyTasks";

export default async function StudentHome() {
  const user = await requireUser(["STUDENT"]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Моё место на занятии</h1>
      <MyTasksSection
        studentId={user.id}
        empty="Сейчас вы не записаны ни на одно занятие. Можно потренироваться самостоятельно: выберите место ниже и нажмите «Тренировка без занятия»."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/op112" className="rounded border bg-white p-6 hover:border-arm-blue">
          <div className="text-lg font-semibold">Оператор 112</div>
          <div className="text-sm text-arm-desc">Принять вызов, заполнить карточку, оповестить службы</div>
        </Link>
        <Link href="/dds" className="rounded border bg-white p-6 hover:border-arm-blue">
          <div className="text-lg font-semibold">Диспетчер ДДС</div>
          <div className="text-sm text-arm-desc">Принять карточку за 30 секунд, вести статусы по докладам бригады</div>
        </Link>
      </div>
    </div>
  );
}
