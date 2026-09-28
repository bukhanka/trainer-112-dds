import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CertificateView } from "@/components/Certificate";
import { requireUser } from "@/lib/auth/session";
import { loadCertificate } from "@/lib/reports/certificate";

export const metadata: Metadata = { title: "Сертификат о прохождении занятия" };

/** The student's own certificate: the lesson is looked up by the student's own place, another one's is «not found». */
export default async function StudentCertificatePage(props: PageProps<"/student/certificates/[lessonId]">) {
  const user = await requireUser(["STUDENT"]);
  const { lessonId } = await props.params;
  const data = await loadCertificate(lessonId, user.id);
  if (!data) notFound();
  return <CertificateView data={data} back={{ href: "/student/results", label: "Мои результаты" }} />;
}
