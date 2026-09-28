"use server";

import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generateScenarioDraft } from "@/lib/scenarios/generate";

const inputSchema = z.object({
  text: z.string().trim().min(15, "Слишком короткий текст — подставьте его в поле и допишите, что случилось и где").max(20_000),
  label: z.string().trim().max(120).optional(),
  fileName: z.string().trim().max(200).optional(),
  difficulty: z.number().int().min(1).max(10).optional(),
});

export type TicketDraftResult = { ok: true; id: string; title: string; usedModel: boolean } | { ok: false; error: string };

/**
 * A draft from one situation of an uploaded ticket file — the same path as «Создать черновик сценария» from typed
 * text, without leaving the page, so that the other situations of the file can follow. The teacher's note of the
 * draft says which file and which ticket it came from.
 */
export async function createDraftFromTicket(input: z.input<typeof inputSchema>): Promise<TicketDraftResult> {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Неверный запрос" };
  const { text, label, fileName, difficulty } = parsed.data;
  try {
    const result = await generateScenarioDraft({ text, difficulty }, user);
    const draft = await db.scenario.findUnique({ where: { id: result.id }, select: { title: true, teacherNote: true } });
    const from = [fileName && `файла «${fileName}»`, label].filter(Boolean).join(", ");
    if (from) await db.scenario.update({ where: { id: result.id }, data: { teacherNote: `Из ${from}. ${draft?.teacherNote ?? ""}`.trim() } });
    await audit({
      action: "scenario.generate",
      actorId: user.id,
      actor: user.login,
      entity: "Scenario",
      entityId: result.id,
      after: { via: "file", ...(fileName ? { file: fileName } : {}), ...(label ? { ticket: label } : {}), finalType: result.finalType, services: result.services, usedModel: result.usedModel },
    });
    return { ok: true, id: result.id, title: draft?.title ?? "Черновик сценария", usedModel: result.usedModel };
  } catch (err) {
    console.error("draft from a ticket file failed", err);
    return { ok: false, error: "Не удалось собрать черновик — попробуйте ещё раз" };
  }
}
