import Link from "next/link";
import { buttonClass } from "@/components/ui";

/** Wrong link, someone else's or a deleted attempt, lesson or card — one plain page instead of the default. */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-5xl font-semibold text-arm-dark">404</div>
      <h1 className="text-xl font-semibold">Страница не найдена</h1>
      <p className="text-arm-desc">
        Ссылка устарела, набрана с ошибкой или ведёт туда, куда у вашей учётной записи нет доступа: чужое занятие, попытка или карточка.
      </p>
      <Link href="/" className={buttonClass("primary")}>
        На главную
      </Link>
    </main>
  );
}
