import Link from "next/link";
import type { SessionUser } from "@/lib/auth/session";

const ROLE_LABEL = { ADMIN: "Администратор", TEACHER: "Преподаватель", STUDENT: "Обучающийся" } as const;

export type NavItem = { href: string; label: string };

/** Frame for the admin, teacher and student cabinets (the workstations use their own full-screen frame). */
export function AppShell({ user, nav, children }: { user: SessionUser; nav: NavItem[]; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-arm-dark px-4 py-2 text-white">
        <Link href="/" className="text-lg font-bold">
          112 · Тренажёр
        </Link>
        <nav className="flex flex-wrap gap-4 text-sm">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="text-white/80 hover:text-white">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span>
            {user.fullName} <span className="text-white/60">· {ROLE_LABEL[user.role]}</span>
          </span>
          <form action="/logout" method="post">
            <button className="rounded border border-white/30 px-2 py-0.5 text-white/80 hover:bg-white/10">Выйти</button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
