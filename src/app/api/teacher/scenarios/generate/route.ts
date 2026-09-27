import { z } from "zod";
import { generateByCategory, MAX_DRAFTS } from "@/lib/scenarios/by-category";
import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

const bodySchema = z.object({
  category: z.string().trim().min(1, "Выберите категорию").max(80),
  count: z.number().int().min(1, "Сколько черновиков: от 1 до 5").max(MAX_DRAFTS, "Сколько черновиков: от 1 до 5"),
  difficulty: z.number().int().min(1).max(10).nullable().default(null),
  location: z
    .object({ okrug: z.string().trim().min(1).max(20), district: z.string().trim().min(1).max(80).nullable().default(null) })
    .nullable()
    .default(null),
});

/**
 * «Сгенерировать по категории»: up to five drafts from the classifier and the address gazetteer, before
 * the lesson. Every draft waits for the teacher's approval like any generated scenario.
 */
export async function POST(request: Request) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Неверный запрос");
  const input = parsed.data;

  // Each draft goes to the journal as soon as it is saved, so a failure later in the run leaves no draft unrecorded.
  const result = await generateByCategory(input, user, Math.random, (d) =>
    auditBy(user, request, {
      action: "scenario.generate",
      entity: "Scenario",
      entityId: d.id,
      after: {
        via: "category",
        category: input.category,
        location: input.location,
        difficulty: d.difficulty,
        finalType: d.finalType,
        services: d.services,
        usedModel: d.usedModel,
      },
    }),
  );
  if (!result.ok) return jsonError(result.error, 422);
  return Response.json({ drafts: result.drafts, requested: result.requested });
}
