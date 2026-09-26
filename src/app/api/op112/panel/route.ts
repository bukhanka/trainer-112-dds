import { jsonError, op112User } from "@/lib/op112/access";
import { findKind } from "@/lib/op112/catalog";
import { treesFor } from "@/lib/op112/panels";

// Panel of one «что случилось» kind; signs panels are built from the classifier in the database.
export async function GET(req: Request) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const name = new URL(req.url).searchParams.get("kind") ?? "";
  if (!findKind(name)) return jsonError("not_found", 404);
  const trees = await treesFor([name]);
  return Response.json({ tree: trees[name] });
}
