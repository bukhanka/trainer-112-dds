import { requireUser } from "@/lib/auth/session";
import { MaterialsView } from "./MaterialsView";

/** The library of materials: upload, own lessons' materials and the shared ones. */
export default async function TeacherMaterialsPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  return <MaterialsView user={user} />;
}
