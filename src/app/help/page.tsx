import type { Metadata } from "next";
import Link from "next/link";
import { TraineeMemo } from "@/components/help/TraineeMemo";
import { homeFor, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Справка · Тренажёр 112 / ДДС" };

/**
 * The same memo without the cabinet frame: the «?» of the 112 and ДДС workstations opens it in a new tab,
 * for whoever sits at the place (a teacher trying the place too).
 */
export default async function HelpPage() {
  const user = await requireUser();
  return (
    <main className="flex-1 p-4 sm:p-6">
      <Link href={homeFor(user.role)} className="mb-3 inline-block text-sm text-arm-blue hover:underline print:hidden">
        ← В кабинет
      </Link>
      <TraineeMemo />
    </main>
  );
}
