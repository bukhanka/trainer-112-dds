import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { fakeModel } from "./fake-db";

// «Сценарий из текста» on the customer's reference data: the type is a real leaf found by meaning, the
// address is what the text says, «Исправь» of the reference card rebuilds what follows from the type.
type Row = Record<string, unknown> & { code: number; groupId: number; finalType: string; routes: [string, string, string][] };
const types = readDataJson<{ types: Row[] }>("classifier.json").types;
const store = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  model: null as null | ((text: string) => unknown),
}));

vi.mock("@/lib/db", async () => {
  const { readDataJson: read } = await import("@/lib/routing/reference-json");
  const c = read<{ groups: Record<string, unknown>[]; types: (Record<string, unknown> & { code: number; routes: [string, string, string][] })[] }>("classifier.json");
  const routes = c.types.flatMap((t) => t.routes.map(([routeKey, condition, label]) => ({ typeCode: t.code, routeKey, condition, label })));
  return {
    db: {
      incidentType: fakeModel(c.types),
      incidentGroup: fakeModel(c.groups),
      route: fakeModel(routes),
      service: fakeModel(read<Record<string, unknown>[]>("services.json")),
      scenario: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `s${store.created.length + 1}`, ...data };
          store.created.push(row);
          return row;
        },
      },
    },
  };
});
vi.mock("@/lib/ai/provider", () => ({
  llmConfigured: () => store.model !== null,
  chatJson: async (messages: { role: string; content: string }[], schema: { parse: (v: unknown) => unknown }) => schema.parse(store.model!(messages[1].content)),
}));

const { generateScenarioDraft, matchType, readByRules, settleTruth } = await import("@/lib/scenarios/generate");

const code = (name: string) => types.find((t) => t.finalType === name)!.code;
const byRules = (text: string) => {
  const ex = readByRules(text);
  return { type: matchType(types as never, ex.typeHint, text), address: ex.address };
};
type Truth = {
  typeCodes: number[];
  finalType: string;
  address: { street?: string; house?: string; district?: string; okrug?: string };
  services: { shortName: string }[];
  traps: string[];
};
const lastTruth = () => (store.created.at(-1) as { truth: Truth }).truth;

beforeEach(() => {
  store.created = [];
  store.model = null;
});

describe("the type and the address by rules, no model", () => {
  it("a neighbour flooding the flat is a leak, not a railway accident", () => {
    const r = byRules("Сосед сверху заливает, искрит проводка, ул. Рогова 12 кв. 45");
    expect(r.type?.code).toBe(code("Течь (прорыв трубы) в квартире (подъезде подвале)"));
    expect(r.address).toMatchObject({ street: "ул. Рогова", house: "12" });
  });

  it("takes the house as said, in any case form of the street", () => {
    const r = byRules("На остановке у дома 3 по Ленинскому проспекту мужчине плохо, лежит, не отвечает");
    expect([22, 17]).toContain(r.type?.groupId);
    expect(r.address).toMatchObject({ street: "Ленинский пр-т", house: "3" });
  });

  it.each([
    ["Бабушке 80 лет плохо с сердцем, задыхается, ул. Грина, 11", "Плохо с сердцем"],
    ["На Кутузовском проспекте у дома 30 столкнулись две машины, водителя зажало, не может выйти", "ДТП с заблокированными"],
    ["В подъезде сильно пахнет газом, ул. Вавилова, 81", "Запах бытового газа в многоквартирном доме"],
    ["Застряли в лифте между пятым и шестым этажом, нас двое, ул. Берзарина 21", "Застревание в лифте"],
    ["Во дворе дерутся трое, у одного нож, Тюменская улица 5", "Драка на улице"],
  ])("«%s» → «%s»", (text, leaf) => {
    expect(byRules(text).type?.finalType).toBe(leaf);
  });

  it("gives a railway leaf only when the text names the railway", () => {
    expect(matchType(types as never, "авария", "Авария, искрит щиток в подъезде")?.groupId).not.toBe(12);
    expect(matchType(types as never, "Транспорт жд - авария", "Авария поезда на переезде")?.groupId).toBe(12);
  });
});

describe("the draft, with a model", () => {
  it("keeps the model's reading but checks the type and the house against the text", async () => {
    store.model = () => ({
      title: "Затопление квартиры соседом сверху",
      caller: { fullName: "Орлова Анна Петровна", role: "соседка", visibleAddress: "ул. Рогова, 12", situation: "Сосед сверху заливает, искрит проводка!", facts: ["Квартира 45"] },
      address: { street: "ул. Рогова", house: "12" },
      flags: { threat: true },
      typeHint: "авария в системе ЖКХ: затопление квартиры, искрит проводка",
      description: "Затопление квартиры, искрит проводка",
    });
    const r = await generateScenarioDraft({ text: "Сосед сверху заливает, искрит проводка, ул. Рогова 12 кв. 45" }, { id: "t1" });
    expect(r.usedModel).toBe(true);
    const t = lastTruth();
    expect(t.typeCodes).toEqual([code("Течь (прорыв трубы) в квартире (подъезде подвале)")]);
    expect(t.address).toMatchObject({ street: "ул. Рогова", house: "12", district: "Щукино" });
    expect(t.services.map((s) => s.shortName)).not.toContain("МЖД");
  });

  it("does not take a house the text does not say", async () => {
    store.model = () => ({
      title: "Мужчине плохо на остановке",
      caller: { fullName: "Кузнецов Игорь Петрович", role: "прохожий", visibleAddress: "Ленинский проспект, остановка", situation: "Мужчине плохо на остановке", facts: [] },
      address: { street: "Ленинский пр-т", house: "57" },
      typeHint: "плохо",
      description: "Мужчине плохо",
    });
    await generateScenarioDraft({ text: "На остановке у дома 3 по Ленинскому проспекту мужчине плохо, лежит, не отвечает" }, { id: "t1" });
    // Ленинский проспект runs from ЦАО to ЮЗАО: for house 3 neither the district nor the okrug is guessed,
    // the reference asks the operator to clarify (not «ЮЗАО» — house 3 is in Якиманка, ЦАО).
    expect(lastTruth().address).toMatchObject({ street: "Ленинский пр-т", house: "3" });
    expect(lastTruth().address.district).toBeUndefined();
    expect(lastTruth().address.okrug).toBeUndefined();
    expect(lastTruth().traps.join(" ")).toMatch(/уточнить/);

    store.model = () => ({
      title: "Драка",
      caller: { fullName: "Соколов Андрей Ильич", role: "очевидец", visibleAddress: "Тюменская улица", situation: "Во дворе дерутся", facts: [] },
      address: { street: "Тюменская улица", house: "14" },
      typeHint: "драка с ножом во дворе",
      description: "Драка во дворе",
    });
    await generateScenarioDraft({ text: "Во дворе на Тюменской улице дерутся трое, у одного нож" }, { id: "t1" });
    expect(lastTruth().address.house).toBeUndefined();
    expect(lastTruth().finalType).toBe("Драка на улице");
  });
});

describe("«Исправь» of the reference card", () => {
  const rail = code("Транспорт жд - авария");
  const before = {
    truth: { typeCodes: [rail], finalType: "Транспорт жд - авария", address: { street: "ул. Рогова", house: "12" } },
    ddsCard: { classLabel: "Транспорт жд - авария", description: "Сосед сверху заливает", services: ["МЖД", "ФСБ"] },
    ddsReference: { rules: [], services: [{ serviceId: 999, service: "МЖД" }] },
  };

  it("turns a code that does not exist into the nearest real leaf and rebuilds the ДДС sections", async () => {
    const next = {
      typeCodes: [11403000],
      finalType: "Авария в системе ЖКХ (затопление, угроза КЗ)",
      flags: { threat: true },
      address: { street: "ул. Рогова", house: "12" },
    };
    const s = await settleTruth(before, next, "это затопление квартиры, а не железная дорога");
    expect(s.truth.typeCodes).toEqual([code("Течь (прорыв трубы) в квартире (подъезде подвале)")]);
    expect(s.truth.finalType).toBe("Течь (прорыв трубы) в квартире (подъезде подвале)");
    expect(s.ddsCard).toMatchObject({ classLabel: "Течь (прорыв трубы) в квартире (подъезде подвале)", description: "Сосед сверху заливает" });
    expect(s.ddsCard.services).not.toContain("МЖД");
    expect(s.changed).toEqual(["ddsCard", "ddsReference"]);
    expect((s.ddsReference as { services: { service: string }[] }).services.map((x) => x.service)).not.toContain("МЖД");
  });

  it("keeps the old type when the model's is unknown and nothing matches by words", async () => {
    const s = await settleTruth(before, { typeCodes: [1], finalType: "" }, "");
    expect(s.truth.typeCodes).toEqual([rail]);
  });
});

/** A lift, a railway or a transport object for a person in the street would send the wrong services. */
const wrongPlace = (t: { groupId: number; finalType: string } | null) => !t || t.groupId === 12 || /лифт/i.test(t.finalType);

describe("everyday words of the street: medicine and road accidents never become a lift or the railway", () => {
  const medicine = [
    "на остановке мужчина без сознания",
    "Женщине стало плохо в магазине, упала в обморок",
    "Пожилому мужчине плохо с сердцем прямо на улице",
    "Человек упал на улице, разбил голову, кровь",
    "У подъезда лежит мужчина, не двигается",
    "Прохожему плохо, задыхается, сел на лавочку",
    "Девушка потеряла сознание на остановке автобуса",
  ];
  const road = [
    "На пешеходном переходе сбили женщину, она лежит",
    "Машина сбила мальчика на велосипеде во дворе",
    "Две машины столкнулись на перекрёстке, у водителя кровь на лице",
    "Такси врезалось в столб, водитель без сознания",
    "Мотоциклист упал на дороге после столкновения с машиной",
  ];

  it.each(medicine)("«%s» — медицина или человек в опасности, без модели", (text) => {
    const t = byRules(text).type;
    expect(wrongPlace(t)).toBe(false);
    expect([22, 17]).toContain(t?.groupId);
  });

  it.each(road)("«%s» — ДТП, без модели", (text) => {
    const t = byRules(text).type;
    expect(wrongPlace(t)).toBe(false);
    expect(t?.groupId).toBe(2);
  });

  it("a person knocked down on a crossing is «наезд на пешехода»", () => {
    expect(byRules(road[0]).type?.finalType).toBe("ДТП наезд на пешехода");
  });

  // What a model tends to write as the type hint for these texts.
  it.each([
    ["без сознания, требуется медицинская помощь", medicine[0], 22],
    ["обморок", medicine[1], 22],
    ["потеря сознания", medicine[6], 22],
    ["травма головы", medicine[3], 22],
    ["лежит человек", medicine[4], 17],
    ["плохо с сердцем", medicine[2], 22],
    ["ДТП наезд на пешехода", road[0], 2],
    ["ДТП с пострадавшими", road[4], 2],
  ] as const)("model hint «%s» — group %s, never a lift or the railway", (hint, text, group) => {
    const t = matchType(types as never, hint, text);
    expect(wrongPlace(t)).toBe(false);
    expect(t?.groupId).toBe(group);
  });

  it("the reported case end to end: «на остановке мужчина без сознания» with a model stays «Без сознания»", async () => {
    store.model = () => ({
      title: "Мужчина без сознания на остановке",
      caller: { fullName: "Петрова Ольга Николаевна", role: "прохожая", visibleAddress: "остановка", situation: "На остановке мужчина без сознания!", facts: [] },
      address: {},
      typeHint: "без сознания, требуется медицинская помощь",
      description: "На остановке мужчина без сознания",
    });
    await generateScenarioDraft({ text: "на остановке мужчина без сознания" }, { id: "t1" });
    expect(lastTruth().finalType).toBe("Без сознания");
    expect(lastTruth().services.map((x) => x.shortName)).not.toContain("Мослифт");
  });
});

