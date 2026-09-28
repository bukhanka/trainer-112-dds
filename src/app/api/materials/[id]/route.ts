import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiUser } from "@/lib/auth/session";
import { MATERIAL_KINDS, type MaterialKind } from "@/lib/files/detect";
import { contentDisposition } from "@/lib/files/names";
import { deleteMaterial, findVisibleMaterial, materialSnapshot } from "@/lib/materials/service";
import { storedPath } from "@/lib/materials/storage";
import { auditBy, jsonError } from "@/lib/teacher/access";

/**
 * The file of a material the user may see: PDF, text and pictures open in the browser, Office files download;
 * `?download=1` always downloads. Sent as stored — own type, no sniffing, no caching on shared class computers,
 * a sandbox for everything but PDF (the browser's PDF viewer does not run in one).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/materials/[id]">) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const material = await findVisibleMaterial(user, id);
  if (!material) return jsonError("Материал не найден", 404);

  let file: string;
  try {
    file = storedPath(material.storedName);
  } catch {
    return jsonError("Материал не найден", 404);
  }
  const info = await stat(/*turbopackIgnore: true*/ file).catch(() => null);
  if (!info?.isFile()) {
    console.error("material file is missing", material.id, material.storedName);
    return jsonError("Файл материала не найден на сервере — сообщите администратору", 404);
  }

  const kind = MATERIAL_KINDS[material.kind as MaterialKind];
  const inline = new URL(request.url).searchParams.get("download") !== "1" && Boolean(kind?.inline);
  const headers = new Headers({
    "Content-Type": material.mime,
    "Content-Length": String(info.size),
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", material.fileName),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (material.kind !== "pdf") headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  const body = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ file)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers });
}

/** Delete: the uploader or an administrator; the audit journal keeps what it was. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/materials/[id]">) {
  const user = await apiUser(["TEACHER", "ADMIN"]);
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const res = await deleteMaterial(user, id);
  if (!res.ok) return jsonError(res.error, res.status);
  await auditBy(user, request, {
    action: "material.delete",
    entity: "Material",
    entityId: res.material.id,
    before: materialSnapshot(res.material, res.lessonTitle),
  });
  return Response.json({ ok: true });
}
