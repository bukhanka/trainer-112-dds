import { requireUser } from "@/lib/auth/session";
import { GroupsView } from "./GroupsView";

/** Groups of the teacher (the administrator sees all): members and the progress history of every student. */
export default async function GroupsPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  return <GroupsView user={user} />;
}
