/**
 * End-to-end check of a class lesson through the HTTP API — the same calls the screens make.
 * The teacher creates and starts a lesson with a 112 place and a ДДС place; the 112 student takes the
 * call, talks to the AI caller and saves the card, calls the service that works by phone and writes the
 * work-off; then a second witness of the same fire calls, and «Совпадение» links the new card to the first. The
 * card reaches the ДДС place, which accepts it. A second 112 place gets a silent line and closes it with «нет
 * контакта». The teacher watches the board, stops the lesson and gets the attempts.
 *
 *   pnpm exec tsx scripts/e2e-lesson.ts --base http://localhost:3100 [--keep]
 *
 * Needs a running server and the demo seed. The lesson is deleted at the end unless --keep.
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const BASE = args[args.indexOf("--base") + 1] && args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3100";
const KEEP = args.includes("--keep");
const db = new PrismaClient();

type Res = { status: number; body: Record<string, unknown> };
let failures = 0;

function check(ok: boolean, what: string, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}

class Client {
  private cookie = "";
  constructor(readonly login: string) {}
  async signIn(password: string) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: this.login, password }),
    });
    this.cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return res.ok;
  }
  async call(method: string, path: string, body?: unknown): Promise<Res> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie: this.cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body: parsed };
  }
}

async function main() {
  const group = await db.group.findFirstOrThrow({ where: { name: "Учебная группа № 1" } });
  const [s1, s2, s3] = await Promise.all(["student1", "student2", "student3"].map((login) => db.user.findUniqueOrThrow({ where: { login } })));
  const scenario = await db.scenario.findFirstOrThrow({ where: { ticketRef: "Б4-1" } });
  const silent = await db.scenario.findFirstOrThrow({ where: { ticketRef: "НВ-1" } });
  const repeat = await db.scenario.findFirstOrThrow({ where: { ticketRef: "ПВ-1" } });
  const dds = await db.service.findFirstOrThrow({ where: { shortName: "Поселение Северное Бутово" } });
  // A grey plate: the service gets the card only by phone (Service.delivery = PHONE).
  const byPhone = await db.service.findFirstOrThrow({ where: { delivery: "PHONE", visible: true } });

  const teacher = new Client("teacher");
  const op = new Client("student1");
  const disp = new Client("student2");
  const quiet = new Client("student3");
  check(await teacher.signIn("Teacher2026"), "преподаватель вошёл");
  check(await op.signIn("Student2026"), "ученик 1 вошёл (место 112)");
  check(await disp.signIn("Student2026"), "ученик 2 вошёл (место ДДС)");
  check(await quiet.signIn("Student2026"), "ученик 3 вошёл (второе место 112)");

  // 1. Lesson: a 112 place with ticket Б4-1 and a ДДС place of the district from the ticket's address.
  const created = await teacher.call("POST", "/api/teacher/lessons", {
    title: "Проверка 112 → ДДС",
    groupId: group.id,
    settings: { cardSource: "students", tempoSec: 60, maxQueue: 3, ackSec: 30, workSec: 180, typingSec: 65, hints: false, brigadeReports: true },
    seats: [
      { studentId: s1.id, role: "OP112", scenarioIds: [scenario.id, repeat.id] },
      { studentId: s2.id, role: "DDS", serviceId: dds.id },
      { studentId: s3.id, role: "OP112", scenarioIds: [silent.id] },
    ],
  });
  const lessonId = ((created.body.lesson as { id?: string } | undefined)?.id ?? created.body.id) as string | undefined;
  if (!check(created.status < 300 && !!lessonId, "занятие создано", `HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`)) return;
  try {
    const started = await teacher.call("POST", `/api/teacher/lessons/${lessonId}/start`);
    check(started.status < 300, "занятие запущено", `HTTP ${started.status}`);

    // 2. The 112 place: the call rings, the operator answers and asks.
    const ring = await op.call("POST", "/api/op112/ring");
    const callId = (ring.body.call as { id?: string } | undefined)?.id;
    if (!check(!!callId, "вызов поступил на место 112", `HTTP ${ring.status} ${JSON.stringify(ring.body).slice(0, 120)}`)) return;
    const answered = await op.call("POST", `/api/op112/calls/${callId}/answer`);
    const incident = answered.body.incident as { id: string; number: number } | null;
    const opening = ((answered.body.call as { messages?: { text: string }[] } | null)?.messages ?? [])[0]?.text;
    if (!check(!!incident, "вызов принят, карточка открыта", `№ ${incident?.number}; заявитель: «${opening ?? ""}»`)) return;

    for (const q of ["Служба 112, что у вас случилось?", "Уточните точный адрес, номер дома", "Есть пострадавшие? Дом газифицирован?"]) {
      const said = await op.call("POST", `/api/op112/calls/${callId}/messages`, { text: q });
      const reply = (said.body.lines as { role: string; text: string }[] | undefined)?.find((l) => l.role === "counterpart")?.text;
      check(said.status === 200 && !!reply, `оператор: «${q}»`, `заявитель: «${reply ?? ""}»`);
    }

    // 3. Save the card; the district ДДС is added by hand so the check does not depend on the tag panels.
    const saved = await op.call("POST", `/api/op112/incidents/${incident!.id}/save`, {
      draft: {
        caller: { fullName: "Сидорова Анна Викторовна", status: "очевидец" },
        address: { city: "Москва", street: "ул. Грина", house: "11", district: "Северное Бутово", okrug: "ЮЗАО" },
        flags: {},
        cards: [],
        answers: {},
        description: "Горит балкон на 13 этаже, открытое пламя, пострадавших не видят. Ул. Грина, 11, библиотека № 193.",
        manualServiceIds: [dds.id, byPhone.id],
      },
    });
    const plates = ((saved.body.incident as { plates?: { shortName: string; status: string }[] } | null)?.plates ?? []).map((p) => `${p.shortName}: ${p.status}`);
    check(saved.status === 200 && plates.length > 0, "карточка сохранена и оповещены службы", plates.join(", "));

    // 3a. The service that works by phone: «отработана» warns, the operator calls and writes the work-off.
    const early = await op.call("POST", `/api/op112/incidents/${incident!.id}/worked`);
    check(early.status === 409 && early.body.error === "phone_not_notified", "«отработана» предупреждает: служба по телефону не оповещена", JSON.stringify(early.body.missing ?? early.body));
    const dialed = await op.call("POST", `/api/op112/incidents/${incident!.id}/workoffs/call`, { serviceId: byPhone.id });
    const svc = dialed.body.call as { id: string; duty: string; messages: { text: string }[] } | undefined;
    if (!check(dialed.status === 200 && !!svc?.id, `звонок в «${byPhone.shortName}» из отработки`, `«${svc?.messages?.[0]?.text ?? JSON.stringify(dialed.body).slice(0, 120)}»`)) return;
    const passed = await op.call("POST", `/api/op112/service-calls/${svc!.id}/messages`, {
      text: `Служба 112, примите карточку ${incident!.number}: горит балкон на 13 этаже, улица Грина, дом 11.`,
    });
    const took = (passed.body.lines as { text: string; accepted?: boolean }[] | undefined)?.find((l) => l.accepted);
    check(!!took, "дежурный принял карточку", `«${took?.text ?? JSON.stringify(passed.body).slice(0, 160)}»`);
    await op.call("POST", `/api/op112/service-calls/${svc!.id}/hangup`);
    const logged = await op.call("POST", `/api/op112/incidents/${incident!.id}/workoffs`, {
      serviceId: byPhone.id,
      acceptedBy: svc!.duty,
      summary: "Принято, передано бригаде",
      callId: svc!.id,
    });
    check(logged.status === 200 && ((logged.body.workLog as unknown[]) ?? []).length === 1, "отработка записана в журнал", `кто принял — ${svc!.duty}`);
    const worked = await op.call("POST", `/api/op112/incidents/${incident!.id}/worked`);
    check(worked.status === 200, "оператор нажал «отработана»");

    // 3c. A second witness of the same fire: «Совпадение» by the address → «привязать» to the first card.
    const ring3 = await op.call("POST", "/api/op112/ring");
    const call3 = ring3.body.call as { id?: string; phone?: string } | undefined;
    check(call3?.phone === (repeat.caller as { phone?: string }).phone, "повторный вызов звонит после карточки первого", call3?.phone ?? JSON.stringify(ring3.body).slice(0, 120));
    const answered3 = await op.call("POST", `/api/op112/calls/${call3?.id}/answer`);
    const card3 = answered3.body.incident as { id: string; number: number } | null;
    const place = { city: "Москва", street: "улица Грина", house: "11", district: "Северное Бутово", okrug: "ЮЗАО" };
    const found = await op.call("POST", `/api/op112/incidents/${card3?.id}/matches`, { caller: {}, address: place });
    const firstCard = ((found.body.byAddress as { id: string; number: number }[] | undefined) ?? []).find((c) => c.number === incident!.number);
    check(!!firstCard, "«Совпадение» по адресу нашло карточку первого вызова", firstCard ? `№ ${firstCard.number}` : JSON.stringify(found.body).slice(0, 160));
    const linked = await op.call("POST", `/api/op112/incidents/${card3?.id}/link`, { to: firstCard?.id ?? null });
    check(linked.status === 200 && (linked.body.linkedTo as { number?: number } | null)?.number === incident!.number, "новая карточка привязана к первой (подчинённая)");
    await op.call("POST", `/api/op112/incidents/${card3?.id}/save`, {
      draft: {
        caller: { fullName: "Ковалёв Дмитрий", status: "очевидец" },
        address: place,
        flags: {},
        cards: [],
        answers: {},
        description: "Повторный звонок: горит балкон на 13 этаже, ул. Грина, 11, звонит сосед из дома напротив.",
        manualServiceIds: [],
      },
    });
    const worked3 = await op.call("POST", `/api/op112/incidents/${card3?.id}/worked`);
    check(worked3.status === 200, "повторная карточка отработана");

    // 3b. The second 112 place: silence on the line → «нет контакта», an empty card without services.
    const ring2 = await quiet.call("POST", "/api/op112/ring");
    const call2 = (ring2.body.call as { id?: string } | undefined)?.id;
    const answered2 = await quiet.call("POST", `/api/op112/calls/${call2}/answer`);
    const card2 = answered2.body.incident as { id: string } | null;
    const heard = await quiet.call("POST", `/api/op112/calls/${call2}/messages`, { text: "Служба 112, говорите, вас не слышно" });
    const silence = (heard.body.lines as { noise?: string }[] | undefined)?.find((l) => l.noise === "silence");
    check(!!card2 && !!silence, "второе место: в трубке тишина", `HTTP ${heard.status}`);
    const emptied = await quiet.call("POST", `/api/op112/incidents/${card2?.id}/empty`, { reason: "noContact" });
    const row2 = ((emptied.body.journal as { chips: string }[] | undefined) ?? [])[0];
    check(emptied.status === 200 && row2?.chips === "<Нет контакта>", "«нет контакта» → пустая карточка в журнале", row2?.chips ?? "");

    // 4. The ДДС place gets the card and makes the first record at once: «Принята» with a text and a crew.
    await disp.call("GET", "/api/dds/state");
    const feed = await disp.call("GET", "/api/dds/feed");
    const rows = (feed.body.rows ?? feed.body.items ?? []) as { number: number; typeLabel?: string; address?: string }[];
    const row = rows.find((r) => r.number === incident!.number);
    check(!!row, "карточка пришла в ленту ДДС", row ? `${row.address ?? ""}` : `в ленте ${rows.length} карточек, HTTP ${feed.status}`);
    const accepted = await disp.call("POST", `/api/dds/incidents/${incident!.number}/status`, {
      status: "ACCEPTED",
      crewNumber: "12",
      comment: "Принята, направлен дежурный наряд 12",
    });
    check(accepted.status === 200, "ДДС поставила «Принята» с нарядом", `HTTP ${accepted.status} ${accepted.status === 200 ? "" : JSON.stringify(accepted.body).slice(0, 120)}`);

    // 5. The teacher: board, stop, attempts of both places.
    const board = await teacher.call("GET", `/api/teacher/lessons/${lessonId}/board`);
    check(board.status === 200, "доска класса отвечает", `мест: ${((board.body.seats as unknown[]) ?? []).length}`);
    const stopped = await teacher.call("POST", `/api/teacher/lessons/${lessonId}/stop`);
    check(stopped.status < 300, "занятие остановлено");
    const attempts = await db.attempt.findMany({
      where: { lessonId },
      select: { kind: true, score: true, criteria: true, seatId: true, incidentId: true, seat: { select: { studentId: true } } },
    });
    const byKind = (k: string) => attempts.filter((a) => a.kind === k);
    const main112 = attempts.find((a) => a.kind === "OP112" && a.incidentId === incident!.id);
    const repeat112 = attempts.find((a) => a.kind === "OP112" && a.incidentId === card3?.id);
    const quiet112 = byKind("OP112").find((a) => a.seat.studentId === s3.id);
    check(!!main112, "попытка места 112 создана", `балл ${main112?.score ?? "—"}, проверок ${(main112?.criteria as unknown[] | undefined)?.length ?? 0}`);
    const phone = ((main112?.criteria ?? []) as { code: string; ok: boolean | null; evidence?: string }[]).find((c) => c.code === "op112.phone.notified");
    check(phone?.ok === true, "разбор: службы по телефону оповещены", phone?.evidence ?? "проверки нет");
    const link = ((repeat112?.criteria ?? []) as { code: string; ok: boolean | null; evidence?: string }[]).find((c) => c.code === "op112.link.repeat");
    check(link?.ok === true, "разбор повторного вызова: привязан к первой карточке, дубля нет", link?.evidence ?? "проверки нет");
    const empty = ((quiet112?.criteria ?? []) as { code: string; ok: boolean | null }[]).find((c) => c.code === "op112.empty.button");
    check(empty?.ok === true, "разбор второго места: пустой вызов закрыт верной кнопкой", `балл ${quiet112?.score ?? "—"}`);
    check(byKind("DDS").length === 1, "попытка места ДДС создана", `балл ${byKind("DDS")[0]?.score ?? "—"}, проверок ${(byKind("DDS")[0]?.criteria as unknown[] | undefined)?.length ?? 0}`);
  } finally {
    if (!KEEP && lessonId) await db.lesson.delete({ where: { id: lessonId } }).catch(() => undefined);
  }
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await db.$disconnect();
    console.log(failures ? `\nОшибок: ${failures}` : "\nВсё прошло");
    process.exit(failures ? 1 : 0);
  });
