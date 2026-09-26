import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/auth/session";

const NAV = [
  { href: "/teacher", label: "Занятия" },
  { href: "/teacher/scenarios", label: "Сценарии" },
  { href: "/teacher/groups", label: "Группы" },
  { href: "/teacher/reports", label: "Отчёты" },
];

export default async function TeacherLayout({ children }: LayoutProps<"/teacher">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  return (
    <AppShell user={user} nav={NAV}>
      {children}
    </AppShell>
  );
}
