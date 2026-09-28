import { apiUser } from "@/lib/auth/session";
import { isAudience } from "@/lib/materials/access";
import { listMaterials, materialSnapshot, MAX_FILE_BYTES, MAX_FILE_MB, uploadMaterial } from "@/lib/materials/service";
import { auditBy, jsonError } from "@/lib/teacher/access";

/** Room for the other form fields and the part headers on top of the file itself. */
const FORM_SLACK = 256 * 1024;
const tooBig = () => jsonError(`Файл больше ${MAX_FILE_MB} МБ — уменьшите его или разделите на части`, 413);

/** The materials the signed-in user may see: all roles, filtered on the server (src/lib/materials/access.ts). */
export async function GET() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  return Response.json({ materials: await listMaterials(user) }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Upload: multipart form with `file`, `title`, `audience` (all | lesson | staff) and `lessonId`. Teachers and administrators. */
export async function POST(request: Request) {
  const user = await apiUser(["TEACHER", "ADMIN"]);
  if (user instanceof Response) return user;
  if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES + FORM_SLACK) return tooBig();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Файл не дошёл до сервера целиком — попробуйте ещё раз");
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) return jsonError("Выберите файл");
  if (file.size > MAX_FILE_BYTES) return tooBig();
  const audience = form.get("audience") ?? "all";
  if (!isAudience(audience)) return jsonError("Укажите, кому виден материал");
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : null;
  };

  const res = await uploadMaterial(user, {
    title: text("title"),
    audience,
    lessonId: text("lessonId"),
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!res.ok) return jsonError(res.error, res.status);
  await auditBy(user, request, {
    action: "material.upload",
    entity: "Material",
    entityId: res.material.id,
    after: materialSnapshot(res.material, res.lessonTitle),
  });
  return Response.json({ id: res.material.id, title: res.material.title }, { status: 201 });
}
