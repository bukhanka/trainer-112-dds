import Link from "next/link";

export default function StudentHome() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Моё место на занятии</h1>
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
