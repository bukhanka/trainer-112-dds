import { op112User } from "@/lib/op112/access";
import { OKRUGS } from "@/lib/op112/gazetteer";
import { serviceCatalog } from "@/lib/op112/services";

// Directory for the «Добавьте службы» window and the district list of the address block.
export async function GET() {
  const user = await op112User();
  if (user instanceof Response) return user;
  const services = await serviceCatalog();
  const districts = services
    .filter((s) => s.kind === "территориальная" && s.district && !(s.subtype ?? "").startsWith("префектура"))
    .map((s) => ({ okrug: s.okrug ?? "", district: s.district! }))
    .sort((a, b) => a.district.localeCompare(b.district, "ru"));
  return Response.json({
    services: services.map((s) => ({ id: s.id, shortName: s.shortName, fullName: s.fullName })),
    okrugs: OKRUGS,
    districts,
  });
}
