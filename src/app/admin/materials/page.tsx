import { requireUser } from "@/lib/auth/session";
import { MaterialsView } from "@/app/teacher/materials/MaterialsView";

/** Every material of the centre: an administrator sees, uploads and deletes any of them. */
export default async function AdminMaterialsPage() {
  const user = await requireUser(["ADMIN"]);
  return <MaterialsView user={user} />;
}
