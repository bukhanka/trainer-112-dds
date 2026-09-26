import { collectHealth } from "@/lib/admin/health";
import { HealthPanel } from "./HealthPanel";

export default async function AdminHome() {
  return <HealthPanel initial={await collectHealth()} />;
}
