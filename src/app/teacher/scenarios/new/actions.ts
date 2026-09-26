"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { generateScenarioDraft } from "@/lib/scenarios/generate";

export type NewScenarioState = { error?: string; text?: string };

export async function createFromText(_prev: NewScenarioState, form: FormData): Promise<NewScenarioState> {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const text = String(form.get("text") ?? "").trim();
  const difficulty = Number(form.get("difficulty") ?? 0) || undefined;
  if (text.length < 15) return { error: "Опишите ситуацию подробнее: что случилось, где, кто звонит", text };

  const result = await generateScenarioDraft({ text, difficulty }, user);
  await audit({
    action: "scenario.generate",
    actorId: user.id,
    actor: user.login,
    entity: "Scenario",
    entityId: result.id,
    after: { finalType: result.finalType, services: result.services, usedModel: result.usedModel },
  });
  redirect(`/teacher/scenarios/${result.id}`);
}
