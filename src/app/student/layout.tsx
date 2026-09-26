import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/auth/session";

const NAV = [
  { href: "/student", label: "Моё место" },
  { href: "/student/results", label: "Мои результаты" },
  { href: "/student/help", label: "Справка" },
];

export default async function StudentLayout({ children }: LayoutProps<"/student">) {
  const user = await requireUser(["STUDENT"]);
  return (
    <AppShell user={user} nav={NAV}>
      {children}
    </AppShell>
  );
}
