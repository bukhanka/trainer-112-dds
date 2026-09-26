import Link from "next/link";
import { HeadsetCheck } from "./HeadsetCheck";

export default function HeadsetPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-8">
      <Link href="/" className="text-sm text-arm-blue">
        ← назад
      </Link>
      <h1 className="text-xl font-semibold">Проверка гарнитуры</h1>
      <p className="text-sm text-arm-desc">
        Перед занятием проверьте, что слышите собеседника и что ваша речь распознаётся. Микрофон работает только по
        HTTPS: если браузер не спрашивает разрешение, обратитесь к администратору.
      </p>
      <HeadsetCheck />
    </main>
  );
}
