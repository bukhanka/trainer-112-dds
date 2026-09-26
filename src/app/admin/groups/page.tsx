import { requireUser } from "@/lib/auth/session";
import { GroupsView } from "@/app/teacher/groups/GroupsView";

/** All groups of the centre: the administrator creates them, names the teacher and keeps the members. */
export default async function AdminGroupsPage() {
  const user = await requireUser(["ADMIN"]);
  return <GroupsView user={user} />;
}
