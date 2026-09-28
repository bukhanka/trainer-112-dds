import { describe, expect, it } from "vitest";
import { callerOpening, cleanCallerReply, genderOfName, greetingLine, lineTurn, mockOpening, mockReply, spokenMatchesFact, NOISE_TEXT, noiseLines, type Gender, type Persona } from "./caller";
import { askedTopics, expectationOfFact, factCards, findAsked, speech, spokenFact, statusOfRole, topicsOfFact } from "./facts";
import type { CallLine } from "./types";

// A caller in the reference data format (data/scenarios.json, Б4-1).
const persona: Persona = {
  fullName: "Сидорова Анна Викторовна",
  role: "очевидец",
  phone: "+7 (916) 126-34-71",
  visibleAddress: "Москва, ул. Грина, номер дома не знаю, в доме библиотека № 193",
  hiddenAddress: "ул. Грина, дом 11",
  situation: "Горит балкон на тринадцатом этаже! Открытое пламя.",
  facts: [
    "Открытое пламя: балкон и два окна рядом, 13-й этаж",
    "Людей на балконе не видно, пострадавших не видит",
    "Дом 14 этажей, газифицирован (сообщает только на вопрос)",
    "Номер дома не знает, в доме библиотека № 193; при уточнении — дом 11",
  ],
  temper: "calm",
  voice: "female",
};

const at = "2026-09-26T10:00:00.000Z";
const said = (text: string, revealed: string[]): CallLine => ({ role: "counterpart", text, at, revealed });
const asked = (text: string): CallLine => ({ role: "trainee", text, at });
/** The caller has picked up and told what happened. */
const told = [said("Алло, здравствуйте…", []), asked("Служба 112, здравствуйте"), said("Горит балкон на тринадцатом этаже!", ["situation"])];

describe("rule-based caller", () => {
  it("picks up with a short «Алло…» and tells the story only after the operator's greeting", async () => {
    const hello = mockOpening(persona);
    expect(hello).toEqual({ text: "Алло, здравствуйте…", revealed: [] });
    expect(await callerOpening(persona)).toEqual(hello);
    expect(mockOpening({ ...persona, temper: "panic" }).text).toBe("Алло! Алло, это 112?!");
    const story = mockReply(persona, [said(hello.text, [])], "Служба 112, здравствуйте");
    expect(story.text).toBe("Горит балкон на тринадцатом этаже!");
    expect(story.revealed).toContain("situation");
  });

  it("leads with what happened when the first question is about something else", () => {
    const r = mockReply(persona, [said("Алло, здравствуйте…", [])], "Назовите адрес");
    expect(r.text.startsWith("Горит балкон на тринадцатом этаже!")).toBe(true);
    expect(r.text).toContain("библиотека");
    expect(r.revealed).toEqual(expect.arrayContaining(["situation", "address"]));
  });

  it("does not retell what was said: the rest of the story, then «Я же говорю — …»", () => {
    const more = mockReply(persona, told, "Что случилось?");
    expect(more.text).toBe("Открытое пламя.");
    const h = [...told, asked("Что случилось?"), said(more.text, more.revealed)];
    expect(mockReply(persona, h, "Ещё раз, что случилось?").text).toBe("Я же говорю — горит балкон на тринадцатом этаже.");
    expect(mockReply({ ...persona, temper: "panic" }, h, "Что случилось?").text).toBe("Я же говорю — горит балкон на тринадцатом этаже!");
    const withAddress = [...h, asked("Адрес?"), said("Москва, улица Грина", ["address"])];
    expect(mockReply({ ...persona, hiddenAddress: undefined }, withAddress, "Повторите адрес").text).toMatch(/^Повторяю: Москва, улица Грина/);
    expect(mockReply(persona, [...withAddress, asked("Как вас зовут?"), said("Сидорова Анна Викторовна.", ["name"])], "Как вас зовут?").text).toBe(
      "Повторяю: Сидорова Анна Викторовна.",
    );
  });

  it("gives the visible address first and the exact one only on a clarifying question", () => {
    const first = mockReply(persona, [], "Назовите адрес");
    expect(first.text).toContain("библиотека");
    expect(first.text).not.toContain("дом 11");
    const again = mockReply(persona, [said(first.text, first.revealed)], "Адрес точнее?");
    expect(again.text).toContain("дом 11");
    expect(again.revealed).toContain("addressExact");
    expect(mockReply(persona, [], "Какой номер дома?").revealed).toContain("addressExact");
  });

  it("tells a fact only when asked, without the ticket's notes, and marks the whole line as said", () => {
    const gas = mockReply(persona, [], "Дом газифицирован?");
    expect(gas.text).toContain("газифицирован");
    expect(gas.text).not.toMatch(/сообщает|вопрос/);
    const cards = factCards(persona);
    const floors = cards.find((c) => c.topic === "floors")!;
    expect(gas.revealed).toContain(floors.key);
  });

  it("does not leak the exact house through a fact line", () => {
    expect(spokenFact("Номер дома не знает, в доме библиотека № 193; при уточнении — дом 11")).toBe("Номер дома не знаю, в доме библиотека номер 193");
  });

  it("answers several questions of one line", () => {
    expect(mockReply(persona, [], "Как вас зовут и ваш телефон для связи?").revealed).toEqual(expect.arrayContaining(["name", "phone"]));
  });

  it("finds a ticket line by its words when no topic fits", () => {
    const p = { ...persona, facts: ["Горит кабина автобуса маршрута № 63, бортовой № 15477"] };
    expect(mockReply(p, [], "Какой номер маршрута?").text).toContain("63");
  });

  it("says it does not know what is not in the ticket", () => {
    const r = mockReply({ ...persona, facts: [] }, told, "Есть угроза людям?");
    expect(r.revealed).toEqual([]);
    expect(r.text).toMatch(/не знаю/i);
  });

  it("thanks the operator when help is on the way and speaks in the persona's manner", () => {
    expect(mockReply(persona, told, "Помощь выезжает, ожидайте").text).toMatch(/спасибо/i);
    expect(mockReply({ ...persona, temper: "panic" }, [], "Служба 112").text).toMatch(/^Помогите! .*Быстрее/);
    expect(mockReply({ ...persona, temper: "elderly" }, [], "Служба 112", "male").text).toMatch(/Сынок/);
  });
});

describe("model caller disclosures", () => {
  const cards = factCards(persona);

  it("falls back when the model claims a different address, name, phone or critical flag", () => {
    expect(() => cleanCallerReply({ reply: "Улица Грина, дом 12", revealed: ["addressExact"] }, cards)).toThrow();
    expect(() => cleanCallerReply({ reply: "Меня зовут Сидорова Ольга", revealed: ["name"] }, cards)).toThrow();
    expect(() => cleanCallerReply({ reply: "Телефон 8 999 999 99 99", revealed: ["phone"] }, cards)).toThrow();
    const victims = cards.find((c) => c.topic === "victims")!;
    expect(spokenMatchesFact(victims, "Есть трое пострадавших")).toBe(false);
    expect(() => cleanCallerReply({ reply: "Есть трое пострадавших", revealed: [victims.key] }, cards)).toThrow();
  });

  it("accepts the caller's real values, including a name without patronymic", () => {
    expect(cleanCallerReply({ reply: "Меня зовут Сидорова Анна", revealed: ["name"] }, cards).revealed).toContain("name");
    expect(cleanCallerReply({ reply: "Телефон +7 916 126-34-71", revealed: ["phone"] }, cards).revealed).toContain("phone");
    expect(cleanCallerReply({ reply: "Улица Грина, дом 11", revealed: ["addressExact"] }, cards).revealed).toContain("addressExact");
  });

  it("does not infer a wrong disclosed fact when the model omits its metadata", () => {
    expect(cleanCallerReply({ reply: "Телефон 8 999 999 99 99" }, cards).revealed).not.toContain("phone");
  });
});

describe("facts of the tickets", () => {
  it("splits a line into topics and knows what each means for the card", () => {
    expect(topicsOfFact("Дом 14 этажей, газифицирован")).toEqual(expect.arrayContaining(["floors", "gas"]));
    expect(expectationOfFact("floors", "Дом 14 этажей, газифицирован")).toEqual({ kind: "tag", row: "Этажность здания", value: "14" });
    expect(expectationOfFact("gas", "Дом 17 этажей, газа в доме нет (электроплиты)")).toEqual({ kind: "flag", flag: "gas", value: false });
    expect(expectationOfFact("gas", "Газифицирован ли дом — не знает")).toBeUndefined();
    expect(expectationOfFact("gas", "Газ магистральный (на вопрос «магистральный или баллон»)")).toMatchObject({ kind: "tag", value: "Магистральный" });
    expect(expectationOfFact("victims", "Людей на балконе не видно, пострадавших не видит")).toEqual({ kind: "flag", flag: "victims", value: false });
    expect(expectationOfFact("victims", "Других пострадавших нет")).toBeUndefined();
    expect(expectationOfFact("victims", "В троллейбусе 3 пострадавших, не заблокированы")).toEqual({ kind: "flag", flag: "victims", value: true });
  });

  it("recognises what the operator asks", () => {
    expect(askedTopics("Уточните, пожалуйста, номер дома")).toContain("addressExact");
    expect(askedTopics("Газ магистральный или баллон?")).toContain("gas");
    expect(askedTopics("Какой точный адрес?")).toContain("addressExact");
  });

  it("matches free-text required questions", () => {
    expect(findAsked({ text: "Номер маршрута и бортовой номер" }, ["Какой номер маршрута?"])).toBeTruthy();
    expect(findAsked({ text: "Есть ли оружие" }, ["У них есть оружие?"])).toBeTruthy();
    expect(findAsked({ text: "Этажность, этаж заявителя" }, ["Сколько этажей в доме?"])).toBeTruthy();
    expect(findAsked({ text: "Есть ли оружие" }, ["Как вас зовут?"])).toBeUndefined();
  });

  it("maps ticket roles to the six caller statuses", () => {
    expect(statusOfRole("мама")).toBe("родственник");
    expect(statusOfRole("сосед")).toBe("знакомый");
    expect(statusOfRole("очевидец")).toBe("очевидец");
    expect(statusOfRole("вызывает себе")).toBe("пострадавший");
    expect(statusOfRole("хозяйка дома")).toBeUndefined();
  });
});

describe("what counts as said", () => {
  it("a shared word is not enough: the needed value must be in the line", async () => {
    const { mockOpening: open } = await import("./caller");
    const p: Persona = {
      ...persona,
      situation: "У нас в подъезде дым идёт из мусоропровода, весь этаж задымлён.",
      facts: ["Дом 17 этажей, заявитель на 7-м, подъезд 3, домофон 68"],
    };
    const floors = factCards(p).find((c) => c.topic === "floors")!;
    expect(open(p).revealed).toEqual([]);
    expect(mockReply(p, [], "Служба 112, слушаю").revealed).not.toContain(floors.key);
  });

  it("does not take «магазин» for gas or «строение» for people", () => {
    expect(askedTopics("В каком магазине горит?")).not.toContain("gas");
    expect(topicsOfFact("Точный адрес: строение 2")).not.toContain("people");
  });

  it("keeps the exact address out of the facts", () => {
    const p: Persona = { ...persona, facts: [...persona.facts, "Точный адрес знает только если спросить: ул. Грина, дом 11"] };
    expect(factCards(p).some((c) => /Грина, дом 11/.test(c.text) && c.group)).toBe(false);
  });

  it("maps harder roles right", () => {
    expect(statusOfRole("сама себе")).toBe("пострадавший");
    expect(statusOfRole("потерпевшая")).toBe("пострадавший");
    expect(statusOfRole("мама ребёнка")).toBe("родственник");
    expect(statusOfRole("медсестра")).toBeUndefined();
    expect(statusOfRole("мужчина с собакой")).toBe("очевидец");
  });
});

describe("a silent line and a call that breaks off («нет контакта», «срыв звонка»)", () => {
  const op = (text: string): CallLine => ({ role: "trainee", text, at });
  const silent: Persona = { ...persona, line: "silent", dropAfter: 3 };
  const drops: Persona = {
    ...persona,
    hiddenAddress: undefined,
    visibleAddress: "улица Берзарина, дом 21, во дворе",
    line: "drops",
    dropAfter: 3,
    dropLine: "Я же сказала — Берзарина, двадцать од…",
  };

  it("a silent line opens with silence and answers with silence, never with words", async () => {
    const opening = await callerOpening(silent);
    expect(opening).toMatchObject({ text: NOISE_TEXT.silence, noise: "silence", revealed: [] });
    expect(lineTurn(silent, [], "Служба 112, говорите!")).toEqual({ kind: "silence", hangup: false });
    const lines = noiseLines({ kind: "silence", hangup: false }, at);
    expect(lines).toEqual([{ role: "counterpart", text: NOISE_TEXT.silence, at, revealed: [], noise: "silence" }]);
  });

  it("after the set number of tries the silent caller hangs up", () => {
    const history = [op("Алло?"), op("Говорите, вас не слышно")];
    expect(lineTurn(silent, history, "Перезвоните, пожалуйста")).toEqual({ kind: "silence", hangup: true });
    expect(noiseLines({ kind: "silence", hangup: true }, at).map((l) => l.noise)).toEqual(["silence", "hangup"]);
  });

  it("a breaking line breaks when the address is asked again after the caller has named it", () => {
    const named: CallLine[] = [op("Назовите адрес"), said(drops.visibleAddress, ["address"])];
    expect(lineTurn(drops, named, "Как вас зовут?")).toEqual({ kind: "talk" });
    expect(lineTurn(drops, named, "Уточните номер дома, какой подъезд?")).toEqual({ kind: "drop", words: drops.dropLine });
    expect(lineTurn(drops, [], "Назовите адрес")).toEqual({ kind: "talk" });
  });

  it("a breaking line also breaks on its n-th operator line; the break ends with the beeps", () => {
    const history = [op("Что случилось?"), op("Есть пострадавшие?")];
    const turn = lineTurn(drops, history, "Как вас зовут?");
    expect(turn).toEqual({ kind: "drop", words: drops.dropLine });
    const lines = noiseLines(turn as Exclude<typeof turn, { kind: "talk" }>, at);
    expect(lines.map((l) => l.text)).toEqual([drops.dropLine, NOISE_TEXT.hangup]);
    expect(lines[0].noise).toBeUndefined();
    expect(lines[1].noise).toBe("hangup");
  });

  it("a written opening is said as it is, with or without a model", async () => {
    const early: Persona = { ...persona, line: "drops", dropAfter: 1, opening: "Алло! Алло, это сто двенадцать? Тут у нас…" };
    expect((await callerOpening(early)).text).toBe("Алло! Алло, это сто двенадцать? Тут у нас…");
    expect(lineTurn(early, [], "Служба 112, что случилось?").kind).toBe("drop");
  });

  it("an ordinary caller always talks", () => {
    expect(lineTurn(persona, [op("Назовите адрес"), said("ул. Грина", ["address"])], "Уточните адрес")).toEqual({ kind: "talk" });
  });
});

describe("the caller without a model speaks like a person", () => {
  const op = (text: string): CallLine => ({ role: "trainee", text, at });
  const reply = (text: string): CallLine => ({ role: "counterpart", text, at, revealed: [] });

  it("«сынок» / «дочка» and «дядя» / «тётя» only by the operator's gender, none when it is unknown", () => {
    const story = (p: Persona, g: Gender = null) => mockReply(p, [reply(greetingLine(p))], "Служба 112, слушаю", g).text;
    const elderly: Persona = { ...persona, temper: "elderly", voice: "male" };
    expect(story(elderly, "male")).toContain("Сынок");
    expect(story(elderly, "female")).toContain("Дочка");
    expect(story(elderly)).not.toMatch(/Сынок|Дочка/);
    const child: Persona = { ...persona, temper: "child" };
    expect(story(child, "male")).toContain("Дядя");
    expect(story(child, "female")).toContain("Тётя");
    expect(story(child)).not.toMatch(/Дядя|Тётя/);
    expect(genderOfName("Морозов Павел Николаевич")).toBe("male");
    expect(genderOfName("Иванова Анна Сергеевна")).toBe("female");
    expect(genderOfName("Ким")).toBeNull();
  });

  it("«Ой…» and «Быстрее!» come now and then, not before every line", () => {
    const elderly: Persona = { ...persona, temper: "elderly" };
    const first = mockReply(elderly, told, "Назовите адрес");
    expect(first.text.startsWith("Ой…")).toBe(true);
    const second = mockReply(elderly, [...told, op("Назовите адрес"), reply(first.text)], "Как вас зовут?");
    expect(second.text.startsWith("Ой…")).toBe(false);
    const panic: Persona = { ...persona, temper: "panic" };
    const a = mockReply(panic, told, "Назовите адрес");
    const b = mockReply(panic, [...told, op("Назовите адрес"), reply(a.text)], "Как вас зовут?");
    expect(a.text).not.toMatch(/Быстрее!/);
    expect(b.text).toMatch(/Быстрее!$/);
  });

  it("the ticket's shorthand is spelt out: «03 не требуется», «а/м», «д/р»", () => {
    expect(speech("Пострадавших нет, 03 не требуется")).toBe("Пострадавших нет, скорая не нужна");
    expect(speech("Горит а/м «Фольксваген»")).toBe("Горит машина «Фольксваген»");
    expect(speech("едут в а/м «Фольксваген» синий")).toBe("едут в машине «Фольксваген» синий");
    expect(speech("Соколова Ирина, д/р 20.05.1979")).toBe("Соколова Ирина, дата рождения 20.05.1979");
    expect(spokenFact("Пострадавших нет, 03 не требуется")).toBe("Пострадавших нет, скорая не нужна");
    const p: Persona = { ...persona, situation: "Свист от газовой трубы в квартире, на кухне. 03 не требуется", facts: [] };
    const story = mockReply(p, [reply(greetingLine(p))], "Что случилось?");
    const what = mockReply(p, [reply(greetingLine(p)), op("Что случилось?"), said(story.text, story.revealed)], "Что случилось?");
    expect(what.text).not.toContain("03");
    expect(what.text).toBe("Скорая не нужна.");
  });
});
