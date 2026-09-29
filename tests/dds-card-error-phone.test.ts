import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone of a ДДС place on a card with an error in it (variant «Б2-1-ош»): the crew reports the error from the site —
// also when its arrival call was missed — and the 112 operator corrects the card only when the dispatcher has named
// the card number and the right information. The model is a stub: it says what the test gives it.
const T0 = Date.UTC(2026, 8, 28, 5, 12, 0);
const at = (sec: number) => new Date(T0 + sec * 1000);
type Row = Record<string, unknown> & { id: string };

const store = vi.hoisted(() => ({ calls: [] as Row[], incident: null as null | Row, model: null as null | string }));

vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  chat: async (_messages: unknown, opts: { mock?: () => string }) => store.model ?? opts.mock?.() ?? "",
}));

const fits = (row: Row, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "AND" || k === "OR") return true; // the feed filter of the place: the only card is the place's
    if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(row[k]);
    if (v && typeof v === "object" && "lt" in v) return (row[k] as Date) < (v.lt as Date);
    return row[k] === v;
  });

vi.mock("@/lib/db", () => {
  const withIncident = (c: Row | undefined) => c && { ...c, incident: c.incidentId ? { number: store.incident!.number } : null };
  const call = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => store.calls.find((c) => fits(c, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => store.calls.filter((c) => fits(c, where)).map(withIncident),
    findUnique: async ({ where }: { where: { id: string } }) => store.calls.find((c) => c.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => withIncident(store.calls.find((c) => c.id === where.id))!,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `c${store.calls.length + 1}`, holds: [], endedAt: null, ...data } as Row;
      store.calls.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(store.calls.find((c) => c.id === where.id)!, data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = store.calls.filter((c) => fits(c, where));
      for (const c of hit) Object.assign(c, data);
      return { count: hit.length };
    },
  };
  const incident = {
    findMany: async () => [store.incident],
    findFirst: async () => store.incident,
    findUnique: async () => store.incident,
    update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(store.incident!, data),
  };
  const db: Record<string, unknown> = { call, incident, service: { findMany: async () => [] }, $executeRaw: async () => 0 };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db };
});

const { answer, dial, phoneBook, say, BOOK_112 } = await import("@/lib/dds/calls");

const SERVICE = { id: 87, shortName: "Поселение Хорошево-Мневники", phone: null };
const seat = { id: "seat-1", lessonId: "l1", serviceId: 87, service: SERVICE, lesson: { status: "RUNNING", settings: {} } } as never;

const ddsReference = {
  services: [{ service: SERVICE.shortName, decision: "ACCEPTED", chain: ["ACCEPTED", "STARTED", "ARRIVED", "FINISHED"], brigadeReport: "Сотрудник ГБУ «Жилищник» прибыл в пятый подъезд, камера очищена" }],
  cardError: {
    what: "подъезд",
    inCard: "под. 3",
    onSite: "подъезд 5 (в третьем подъезде всё чисто)",
    report: "по адресу из карточки, в третьем подъезде, всё чисто — дымит мусоропровод в пятом подъезде",
    mustSay: ["(под\\.?|подъезд\\S*)\\s*№?\\s*5(?!\\d)", "(?<!\\d)5\\s*-?\\s*(й|ый|ом|м|го|ого)?\\s*подъезд", "пят\\S*\\s+подъезд"],
    fix: { address: { entrance: "5", code: null } },
  },
};

function reset() {
  store.model = null;
  store.incident = {
    id: "i1",
    number: 36815072,
    description: "Задымление мусоропровода",
    caller: {},
    flags: { victims: false },
    address: { street: "ул. Берзарина", house: "21", building: "1", entrance: "3", code: "68" },
    descriptionLog: [{ at: at(-60).toISOString(), author: "0 УМЦ О.п.", text: "Задымление мусоропровода" }],
    scenario: { id: "s1", title: "Б2-1-ош", category: "пожар", caller: {}, truth: {}, ddsCard: {}, ddsReference },
    // crew 23 sent with «Принята» at T0: on site at +81 s (crew.ts), done at +180 s
    services: [
      {
        serviceId: 87,
        status: "ACCEPTED",
        service: SERVICE,
        events: [
          { status: "ADDED", crewNumber: null, at: at(-30) },
          { status: "ACCEPTED", crewNumber: "23", at: at(0) },
        ],
      },
    ],
  };
  // The crew rang on arrival and nobody picked up.
  store.calls = [
    {
      id: "c-missed",
      seatId: "seat-1",
      lessonId: "l1",
      incidentId: "i1",
      kind: "BRIGADE_IN",
      status: "MISSED",
      counterpart: { kind: "crew", crew: "23", name: "Громов", role: "старший наряда 23", stage: "ARRIVED" },
      messages: [],
      holds: [],
      startedAt: at(81),
      answeredAt: null,
      endedAt: at(106),
    },
  ];
}

const lines = (id: string) => (store.calls.find((c) => c.id === id)!.messages as { role: string; text: string }[]).map((m) => m.text);
const reports = (id: string) => ((store.calls.find((c) => c.id === id)!.counterpart as { reports?: { status: string }[] }).reports ?? []).map((r) => r.status);

describe("ДДС phone: an error in the card", () => {
  beforeEach(reset);

  it("a call back after the missed arrival report: the leader reports from the site at once, the error included", async () => {
    const res = await dial(seat, "23", "i1", at(110));
    expect(res.ok).toBe(true);
    const id = res.ok ? res.call.id : "";
    expect(lines(id)[0]).toMatch(/^Наряд 23, .+, слушаю\. Докладываю: прибыли на место, .+Внимание, диспетчер: в карточке ошибка — .+в пятом подъезде/);
    expect(reports(id)).toEqual(["ARRIVED"]); // the dispatcher has heard it now — the review sees a report from the site
    // Asked about the address, the leader answers as it is on site, not «третий подъезд, всё верно».
    const reply = await say(seat, id, "Адрес в карточке совпал? Подъезд верный?", at(115));
    expect(reply.ok && reply.call.messages.at(-1)?.text).toMatch(/в карточке ошибка/);
    expect(reply.ok && reply.call.messages.at(-1)?.text).not.toMatch(/Всё верно/);
  });

  it("the model's answer that leaves the error out is completed with it", async () => {
    store.model = "Работаем, всё по плану.";
    // The dispatcher called the crew on its way (+70 s); it got to the site during the talk.
    store.calls.push({ ...store.calls[0], id: "c-out", kind: "BRIGADE_OUT", status: "ACTIVE", counterpart: { kind: "crew", crew: "23", name: "Громов", role: "" }, messages: [], startedAt: at(70) });
    const reply = await say(seat, "c-out", "Как обстановка?", at(120));
    expect(reply.ok && reply.call.messages.at(-1)?.text).toMatch(/^Работаем, всё по плану\. Внимание, диспетчер: в карточке ошибка — .+в пятом подъезде\.$/);
    expect(reports("c-out")).toEqual(["ARRIVED"]);
    // Told once: the next answer is the model's own.
    const next = await say(seat, "c-out", "Понял вас, что ещё?", at(125));
    expect(next.ok && next.call.messages.at(-1)?.text).toBe("Работаем, всё по плану.");
  });

  it("the next incoming report carries the error when the arrival call was missed", async () => {
    store.calls.push({ ...store.calls[0], id: "c-ring", status: "RINGING", counterpart: { kind: "crew", crew: "23", name: "Громов", role: "", stage: "FINISHED" }, startedAt: at(181), endedAt: null });
    const res = await answer(seat, "c-ring", at(185));
    expect(res.ok).toBe(true);
    expect(lines("c-ring")[0]).toMatch(/^Наряд 23: работы закончили\. .+Внимание, диспетчер: в карточке ошибка — .+Возвращаемся на базу\.$/);
  });

  it("the 112 operator corrects the card on the card number and the right information — and says so only then", async () => {
    const call = await dial(seat, "112", null, at(200));
    expect(call.ok).toBe(true);
    const id = call.ok ? call.call.id : "";
    // The model claims a correction nobody made: the operator's rule line is said instead.
    store.model = "Принято, данные обновил, службы переоповестил. Всего доброго.";
    const first = await say(seat, id, "ДДС Хорошёво-Мнёвники, диспетчер Кузнецов. В карточке ошибка по подъезду.", at(205));
    expect(first.ok && first.call.messages.at(-1)?.text).toBe("Понял, в карточке ошибка. Назовите номер карточки и что указать верно.");
    expect((store.incident!.address as Record<string, string>).entrance).toBe("3");

    const second = await say(seat, id, "Карточка 36815072: в карточке третий подъезд, а задымление в пятом подъезде.", at(210));
    // The correction is true now; nobody notified the services again — that clause goes, «передам» comes (operator-claims.ts).
    expect(second.ok && second.call.messages.at(-1)?.text).toBe("Принято, данные обновил. Остальное передам старшему смены. Всего доброго.");
    expect(store.incident!.address).toEqual({ street: "ул. Берзарина", house: "21", building: "1", entrance: "5" });
    const log = store.incident!.descriptionLog as { author: string; text: string }[];
    expect(log.at(-1)).toMatchObject({ author: "оп. 112", text: expect.stringMatching(/^Изменено оператором 112 по звонку диспетчера «Поселение Хорошево-Мневники»: подъезд 5/) });

    // Said once more: the card is corrected once.
    store.model = null;
    const third = await say(seat, id, "Повторяю: карточка 36815072, пятый подъезд.", at(215));
    expect(third.ok && third.call.messages.at(-1)?.text).toMatch(/уже внесено: подъезд 5/);
    expect((store.incident!.descriptionLog as unknown[]).length).toBe(2);
  });

  it("after the correction the crew no longer calls the card wrong", async () => {
    store.incident!.descriptionLog = [...(store.incident!.descriptionLog as object[]), { at: at(150).toISOString(), author: "оп. 112", text: "Изменено оператором 112 по звонку диспетчера «…»: подъезд 5." }];
    store.incident!.address = { street: "ул. Берзарина", house: "21", building: "1", entrance: "5" };
    const res = await dial(seat, "23", "i1", at(160));
    // spoken words, not the card's abbreviations (src/lib/speech/sayable.ts)
    expect(res.ok && res.call.messages[0].text).toMatch(/прибыли на место, улица Берзарина, дом 21, корпус 1, подъезд 5\. Осматриваемся\.$/);
  });

  it("the phone book has the 112 operator", async () => {
    const book = await phoneBook(seat);
    expect(book).toContainEqual(BOOK_112);
    expect(BOOK_112.phone).toBe("112");
  });
});
