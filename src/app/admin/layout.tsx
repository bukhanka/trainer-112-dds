import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/auth/session";

const NAV = [
  { href: "/admin", label: "Состояние" },
  { href: "/admin/stats", label: "Статистика" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/groups", label: "Группы" },
  { href: "/admin/audit", label: "Журнал аудита" },
  { href: "/admin/backups", label: "Резервные копии" },
  { href: "/admin/settings", label: "Настройки" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireUser(["ADMIN"]);
  return (
    <AppShell user={user} nav={NAV}>
      {children}
    </AppShell>
  );
}
