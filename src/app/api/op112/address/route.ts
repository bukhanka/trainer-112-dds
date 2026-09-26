import { op112User } from "@/lib/op112/access";
import { suggestAddress } from "@/lib/op112/gazetteer";

// Address suggestions for the single search line of the address block (offline street list).
export async function GET(req: Request) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 200) ?? "";
  return Response.json({ suggestions: suggestAddress(q) });
}
