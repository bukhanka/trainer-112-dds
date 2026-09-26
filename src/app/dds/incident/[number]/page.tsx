import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardScreen } from "@/components/dds/CardScreen";

export async function generateMetadata({ params }: PageProps<"/dds/incident/[number]">): Promise<Metadata> {
  return { title: `Происшествие ${(await params).number}` };
}

export default async function DdsIncident({ params }: PageProps<"/dds/incident/[number]">) {
  const number = Number((await params).number);
  if (!Number.isInteger(number) || number <= 0) notFound();
  return <CardScreen number={number} />;
}
