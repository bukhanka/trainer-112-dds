import { MAX_TICKET_FILE_MB, ticketsFromFile } from "@/lib/scenarios/ticket-file";
import { jsonError, teacherApi } from "@/lib/teacher/access";

const MAX_BYTES = MAX_TICKET_FILE_MB * 1024 * 1024;
const tooBig = () => jsonError(`Файл больше ${MAX_TICKET_FILE_MB} МБ — сохраните билеты отдельным файлом без картинок`, 413);

/**
 * «Сценарий из билета»: the situations of an uploaded ticket file (DOCX, TXT, PDF with text) for the text field of
 * «Сценарий из текста». The file is only read, never stored; drafts are created by the page as from typed text.
 */
export async function POST(request: Request) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  if (Number(request.headers.get("content-length")) > MAX_BYTES + 64 * 1024) return tooBig();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Файл не дошёл до сервера целиком — попробуйте ещё раз");
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) return jsonError("Выберите файл билета");
  if (file.size > MAX_BYTES) return tooBig();
  const res = await ticketsFromFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!res.ok) return jsonError(res.error, 422);
  return Response.json(res.file, { headers: { "Cache-Control": "private, no-store" } });
}
