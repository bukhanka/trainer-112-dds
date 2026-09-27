import type { Metadata } from "next";
import { TraineeMemo } from "@/components/help/TraineeMemo";

export const metadata: Metadata = { title: "Справка · Тренажёр 112 / ДДС" };

/** «Справка» in the student's cabinet (access is checked by the student layout). */
export default function StudentHelpPage() {
  return <TraineeMemo />;
}
