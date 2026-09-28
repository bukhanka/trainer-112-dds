import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CertificateView } from "@/components/Certificate";
import { requireUser } from "@/lib/auth/session";
import { loadCertificate } from "@/lib/reports/certificate";
import { findLesson } from "@/lib/teacher/access";

export const metadata: Metadata = { title: "Сертификат о прохождении занятия" };

/** A student's certificate from the lesson report: own lessons only (an administrator — all), like the report itself. */
export default async function TeacherCertificatePage(props: PageProps<"/teacher/lessons/[id]/certificate/[studentId]">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { id, studentId } = await props.params;
  const lesson = await findLesson(user, id);
  if (!lesson) notFound();
  const data = await loadCertificate(id, studentId);
  if (!data) notFound();
  return <CertificateView data={data} back={{ href: `/teacher/lessons/${id}/report`, label: "Отчёт занятия" }} />;
}
