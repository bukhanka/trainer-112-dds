import { op112User } from "@/lib/op112/access";
import { buildState } from "@/lib/op112/state";

// Workstation snapshot: the student's 112 place, the ringing or active call, the open card, the journal.
export async function GET() {
  const user = await op112User();
  if (user instanceof Response) return user;
  return Response.json(await buildState(user));
}
