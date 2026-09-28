/** LOCAL MEDIA FIXTURE ONLY: simulated later attempts for a consistent same-learner product demo.
 * This does not prove that a real person practiced or learned. The real workstation flow is in e2e-lesson.ts.
 */
import { PrismaClient } from "@prisma/client";
import { computeScore, type CriterionResult } from "../src/lib/scoring/score";
import { normalizeWeights } from "../src/lib/scoring/weight-config";
import { SKILLS, type SkillKey } from "../src/lib/followup/skills";

const id = process.argv[process.argv.indexOf("--followup") + 1];
if (!id || id.startsWith("--")) throw new Error("Pass --followup <local fixture id>");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL ?? "postgres://invalid").hostname)) throw new Error("Local DB only");
const base = "http://127.0.0.1:3112";
const db = new PrismaClient();
async function main() {
  const f = await db.followUp.findUniqueOrThrow({ where: { id }, include: { sourceAttempt: true, practiceLesson: true, controlLesson: true } });
  if (f.practiceLesson.status !== "DRAFT" || f.controlLesson.status !== "DRAFT") throw new Error("Fixture already started");
  const skill = f.skillKey as SkillKey;
  if (!(skill in SKILLS)) throw new Error("Unknown skill");
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "teacher", password: "Teacher2026" }) });
  if (!login.ok) throw new Error(`Teacher login ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const post = async (path: string, body?: unknown, method = "POST") => {
    const res = await fetch(base + path, { method, headers: { cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const snap = f.sourceSnapshot as { practiceScenarioId: string; controlScenarioId: string };
  const actor = await db.user.findUniqueOrThrow({ where: { id: f.practiceLesson.teacherId } });
  const titles: Record<string, string> = {
    "op112.address.street": "Улица совпадает с местом происшествия",
    "op112.address.house": "Дом, корпус, строение",
    "dds.status_by_facts": "Статус соответствует докладу бригады",
    "dds.literacy": "Комментарий понятен следующему диспетчеру",
  };
  const weightSnapshot = f.sourceSnapshot as { weights: unknown };
  const weights = normalizeWeights(weightSnapshot.weights);
  const create = async (lessonId: string, scenarioId: string) => {
    const seat = await db.seat.findFirstOrThrow({ where: { lessonId, studentId: f.sourceAttempt.studentId } });
    const criteria: CriterionResult[] = SKILLS[skill].required.map((code) => ({ code, title: titles[code] ?? code,
      group: code === "dds.literacy" ? "literacy" : code.startsWith("dds.") ? "statusOrder" : "address", ok: true, source: "rule" }));
    const score = computeScore(criteria, weights);
    return db.attempt.create({ data: { lessonId, seatId: seat.id, studentId: f.sourceAttempt.studentId, kind: seat.role, scenarioId,
      criteria, score, reviewStatus: "CONFIRMED", reviewedById: actor.id, reviewedAt: new Date(), teacherComment: "Учебный пример: действие выполнено" } });
  };
  await post(`/api/teacher/lessons/${f.practiceLessonId}/start`);
  await post(`/api/teacher/lessons/${f.practiceLessonId}/stop`);
  await create(f.practiceLessonId, snap.practiceScenarioId);
  await post(`/api/teacher/lessons/${f.controlLessonId}/start`);
  await post(`/api/teacher/lessons/${f.controlLessonId}/stop`);
  const result = await create(f.controlLessonId, snap.controlScenarioId);
  const evidence = skill === "op112.location" ? "Учебный пример: оператор уточнил дом в реплике и внёс его в карточку" : "Учебный пример: диспетчер отразил доклад бригады в статусе и записи";
  const observed = await post(`/api/teacher/followups/${id}`, { action: "observe", stage: "control", attemptId: result.id, observed: true, evidence }, "PATCH");
  if (observed.outcome !== "achieved") throw new Error(`Unexpected outcome ${JSON.stringify(observed)}`);
  console.log("✓ Same learner's demo route reached a reviewed control outcome (synthetic follow-up attempts)");
}
main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => db.$disconnect());
