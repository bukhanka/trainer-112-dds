/** Local-only API check of confirmed error → assigned practice → separate control → teacher observation. */
import { PrismaClient } from "@prisma/client";
import { lessonSettingsSchema } from "../src/lib/lessons/settings";

const base = process.env.FOLLOWUP_E2E_BASE ?? "http://127.0.0.1:3112";
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) throw new Error("Only a loopback test server is allowed");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL ?? "postgres://invalid").hostname)) throw new Error("Only a local test DB is allowed");
const keep = process.argv.includes("--keep");
const reassign = process.argv.includes("--reassign");
const draftLock = process.argv.includes("--draft-lock");
const checkClearedMeta = process.argv.includes("--clear-meta");
const checkSeenCall = process.argv.includes("--seen-call");
const role = process.argv.includes("--dds") ? "DDS" as const : "OP112" as const;
const ticketRefs = role === "DDS" ? ["Б5-2", "Б11-2", "Б14-2"] : ["Б1-1", "Б4-1", "Б11-1"];
const skillKey = role === "DDS" ? "dds.report_record" : "op112.location";
const checks = (success: boolean) => role === "DDS"
  ? [{ code: "dds.status_by_facts", title: "Статус по докладу", group: "statusOrder", ok: success, source: "rule" }, { code: "dds.literacy", title: "Понятный комментарий", group: "literacy", ok: true, source: "rule" }]
  : [{ code: "op112.address.street", title: "Улица", group: "address", ok: true, source: "rule" }, { code: "op112.address.house", title: "Дом", group: "address", ok: success, critical: !success, evidence: success ? "Дом уточнён" : "Дом не уточнён", source: "rule" }];
const db = new PrismaClient();
const createdLessons: string[] = [];
let followUpId: string | null = null;
let sourceAttemptId: string | null = null;
let cookie = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, data };
}
function check(ok: boolean, step: string, details: unknown = "") {
  if (!ok) throw new Error(`${step}: ${JSON.stringify(details)}`);
  console.log(`✓ ${step}`);
}

async function main() {
  const [teacher, student, group, sourceScenario, practiceScenario, controlScenario] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { login: "teacher" } }),
    db.user.findUniqueOrThrow({ where: { login: role === "DDS" ? "student3" : "student1" } }),
    db.group.findFirstOrThrow({ where: { name: "Учебная группа № 1" } }),
    db.scenario.findFirstOrThrow({ where: { ticketRef: ticketRefs[0] } }),
    db.scenario.findFirstOrThrow({ where: { ticketRef: ticketRefs[1] } }),
    db.scenario.findFirstOrThrow({ where: { ticketRef: ticketRefs[2] } }),
  ]);
  const login = await call("POST", "/api/auth/login", { login: "teacher", password: "Teacher2026" });
  check(login.status === 200, "преподаватель вошёл", login);
  // The login endpoint returns a cookie; fetch it again here so the helper can keep the session.
  const rawLogin = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "teacher", password: "Teacher2026" }) });
  cookie = rawLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
  check(Boolean(cookie), "сессия преподавателя получена");

  const service = role === "DDS" ? await db.service.findUniqueOrThrow({ where: { id: 4 } }) : null;
  // A fixed, already reviewed source error. The ordinary 112→DDS call path has its own e2e-lesson.ts.
  const sourceLesson = await db.lesson.create({ data: { title: "Контрольная точка: исходная ошибка", teacherId: teacher.id, groupId: group.id,
    status: "FINISHED", startedAt: new Date(), finishedAt: new Date(), settings: lessonSettingsSchema.parse({}) } });
  createdLessons.push(sourceLesson.id);
  const sourceSeat = await db.seat.create({ data: { lessonId: sourceLesson.id, studentId: student.id, role, serviceId: service?.id ?? null, scenarioIds: [sourceScenario.id] } });
  const source = await db.attempt.create({ data: { lessonId: sourceLesson.id, seatId: sourceSeat.id, studentId: student.id, kind: role, scenarioId: sourceScenario.id,
    criteria: checks(false),
    score: 40, reviewStatus: "CONFIRMED", reviewedById: teacher.id, reviewedAt: new Date(), teacherComment: "Уточнить дом у заявителя" } });
  sourceAttemptId = source.id;
  if (keep && role === "OP112") {
    const another = await db.user.findUniqueOrThrow({ where: { login: "student2" } });
    const extraSeat = await db.seat.create({ data: { lessonId: sourceLesson.id, studentId: another.id, role: "OP112", scenarioIds: [sourceScenario.id] } });
    const extraAttempt = await db.attempt.create({ data: { lessonId: sourceLesson.id, seatId: extraSeat.id, studentId: another.id, kind: "OP112", scenarioId: sourceScenario.id,
      criteria: [{ code: "op112.address.street", title: "Улица", group: "address", ok: true, source: "rule" },
        { code: "op112.address.house", title: "Дом", group: "address", ok: false, critical: true, evidence: "Дом не уточнён", source: "rule" }],
      score: 40, reviewStatus: "CONFIRMED", reviewedById: teacher.id, reviewedAt: new Date(), teacherComment: "Уточнить дом у заявителя" } });
    console.log(`fixture unassignedAttempt=${extraAttempt.id}`);
  }
  const input = { skillKey, items: [{ attemptId: source.id, practiceScenarioId: practiceScenario.id, controlScenarioId: controlScenario.id }] };
  if (checkSeenCall && role === "OP112") {
    const heard = await db.call.create({ data: { lessonId: sourceLesson.id, seatId: sourceSeat.id, kind: "CALLER_IN", status: "ENDED", counterpart: { scenarioId: controlScenario.id } } });
    try {
      const refused = await call("POST", "/api/teacher/followups", input);
      check(refused.status === 409 && String(refused.data.error).includes("уже предъявлялась"), "услышанный без карточки случай нельзя назначить контролем", refused);
    } finally { await db.call.delete({ where: { id: heard.id } }); }
  }
  let created = await call("POST", "/api/teacher/followups", input);
  check(created.status === 201 && created.data.ok === true, "отработка назначена по проверенной ошибке", created);
  if (reassign) {
    createdLessons.push(String(created.data.practiceLessonId), String(created.data.controlLessonId));
    const oldId = String((created.data.followUpIds as string[])[0]);
    const cancelled = await call("PATCH", `/api/teacher/followups/${oldId}`, { action: "cancel", reason: "Повторное назначение после отсутствия ученика" });
    check(cancelled.status === 200, "первое назначение отменено с причиной", cancelled);
    created = await call("POST", "/api/teacher/followups", input);
    check(created.status === 201 && String((created.data.followUpIds as string[])[0]) !== oldId, "та же ошибка назначена заново без потери истории", created);
  }
  const practiceLessonId = String(created.data.practiceLessonId);
  const controlLessonId = String(created.data.controlLessonId);
  followUpId = String((created.data.followUpIds as string[])[0]);
  createdLessons.push(practiceLessonId, controlLessonId);
  const retry = await call("POST", "/api/teacher/followups", input);
  check(retry.status === 200 && retry.data.existing === true, "повтор запроса не создаёт новый маршрут", retry);
  if (draftLock) {
    const edit = await call("PATCH", `/api/teacher/lessons/${practiceLessonId}`, { title: "Подмена упражнения", groupId: group.id, settings: {}, seats: [] });
    check(edit.status === 409, "связанное занятие нельзя изменить обычным редактором", edit);
    const deleted = await call("DELETE", `/api/teacher/lessons/${controlLessonId}`);
    check(deleted.status === 409, "связанное контрольное занятие нельзя удалить", deleted);
    return;
  }
  if (checkClearedMeta) {
    const cleared = await call("PATCH", `/api/teacher/scenarios/${controlScenario.id}`, { learningMeta: null });
    check(cleared.status === 200, "метка контрольного сценария временно снята", cleared);
    try {
      const bypass = await call("POST", `/api/teacher/lessons/${controlLessonId}/start`);
      check(bypass.status === 409 && String(bypass.data.error).includes("Сценарий изменился"), "снятая метка не открывает контроль раньше времени", bypass);
    } finally {
      const restored = await call("PATCH", `/api/teacher/scenarios/${controlScenario.id}`, { learningMeta: controlScenario.learningMeta });
      check(restored.status === 200, "метка сценария восстановлена", restored);
    }
  }
  const early = await call("POST", `/api/teacher/lessons/${controlLessonId}/start`);
  check(early.status === 409, "контроль нельзя начать до отработки", early);
  const started = await call("POST", `/api/teacher/lessons/${practiceLessonId}/start`);
  check(started.status === 200, "отработка запускается существующим занятием", started);
  const stopPractice = await call("POST", `/api/teacher/lessons/${practiceLessonId}/stop`);
  check(stopPractice.status === 200, "отработка завершена", stopPractice);
  const practiceSeat = await db.seat.findFirstOrThrow({ where: { lessonId: practiceLessonId, studentId: student.id } });
  await db.attempt.create({ data: { lessonId: practiceLessonId, seatId: practiceSeat.id, studentId: student.id, kind: role, scenarioId: practiceScenario.id,
    criteria: checks(true),
    score: 100, reviewStatus: "CONFIRMED", reviewedById: teacher.id, reviewedAt: new Date() } });
  const startControl = await call("POST", `/api/teacher/lessons/${controlLessonId}/start`);
  check(startControl.status === 200, "контроль открыт после проверки отработки", startControl);
  const stopControl = await call("POST", `/api/teacher/lessons/${controlLessonId}/stop`);
  check(stopControl.status === 200, "контроль завершён", stopControl);
  const controlSeat = await db.seat.findFirstOrThrow({ where: { lessonId: controlLessonId, studentId: student.id } });
  const controlAttempt = await db.attempt.create({ data: { lessonId: controlLessonId, seatId: controlSeat.id, studentId: student.id, kind: role, scenarioId: controlScenario.id,
    criteria: checks(true),
    score: 100, reviewStatus: "CONFIRMED", reviewedById: teacher.id, reviewedAt: new Date() } });
  const beforeWitness = await call("GET", `/api/teacher/followups/${followUpId}`);
  check(beforeWitness.data.state === "insufficient", "верные поля без наблюдаемого действия ещё не подтверждают навык", beforeWitness);
  const observed = await call("PATCH", `/api/teacher/followups/${followUpId}`, { action: "observe", stage: "control", attemptId: controlAttempt.id,
    observed: true, evidence: role === "DDS" ? "Диспетчер записал статус по докладу бригады и объяснил итог" : "Оператор спросил дом, получил ответ и сверил запись" });
  check(observed.status === 200 && observed.data.outcome === "achieved", "преподаватель подтвердил действие по эпизоду", observed);
  const result = await call("GET", `/api/teacher/followups/${followUpId}`);
  check(result.data.state === "achieved", "цель выполнена на другой ситуации", result);
  if (keep) console.log(`fixture lesson=${sourceLesson.id} attempt=${source.id} followUp=${followUpId} practice=${practiceLessonId} control=${controlLessonId}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(async () => {
  // The script owns all these rows in its dedicated local DB; keep the group and reference data intact.
  if (!keep) {
    if (sourceAttemptId) await db.followUp.deleteMany({ where: { sourceAttemptId } }).catch(() => undefined);
    for (const id of createdLessons.reverse()) await db.lesson.delete({ where: { id } }).catch(() => undefined);
  }
  await db.$disconnect();
});
