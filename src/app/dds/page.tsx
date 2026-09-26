import type { Metadata } from "next";
import { FeedScreen } from "@/components/dds/FeedScreen";

export const metadata: Metadata = { title: "Список происшествий · АРМ ДДС" };

export default function DdsWorkstation() {
  return <FeedScreen />;
}
