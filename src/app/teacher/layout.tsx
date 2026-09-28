import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/auth/session";

const NAV = [
  { href: "/teacher", label: "Занятия" },
  { href: "/teacher/scenarios", label: "Сценарии" },
  { href: "/teacher/materials", label: "Материалы" },
  { href: "/teacher/weights", label: "Веса оценки" },
  { href: "/teacher/corrections", label: "Учёт правок" },
  { href: "/teacher/reports", label: "Отчёты" },
  { href: "/teacher/groups", label: "Группы" },
];

export default async function TeacherLayout({ children }: LayoutProps<"/teacher">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  return (
    <AppShell user={user} nav={NAV}>
      {children}
    </AppShell>
  );
}
