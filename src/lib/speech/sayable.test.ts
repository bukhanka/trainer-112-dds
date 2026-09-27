/** Written shorthand spelt out as it is said, and the address checks still matching the reference. */
import { describe, expect, it } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { streetKey } from "@/lib/routing/address";
import { compareStreets, normHouse } from "@/lib/op112/gazetteer";
import { streetVerdict } from "@/lib/op112/evaluate";
import { sayable } from "./sayable";

describe("sayable: the replacement table", () => {
  it.each([
    ["Москва, ул. Грина, д. 11, под. 2, эт. 5, кв. 45, код 45В", "Москва, улица Грина, дом 11, подъезд 2, этаж 5, квартира 45, код 45В"],
    ["ул. Берзарина, д. 21, к. 1", "улица Берзарина, дом 21, корпус 1"],
    ["ул. Цюрупы, д. 3, корп. 2, стр. 1", "улица Цюрупы, дом 3, корпус 2, строение 1"],
    ["Ул. Вавилова", "Улица Вавилова"],
    ["Волгоградский пр-т, от пр-та Мира, на Ленинском пр-те", "Волгоградский проспект, от проспекта Мира, на Ленинском проспекте"],
    ["Леонтьевский пер., Комсомольская пл., Коломенская наб.", "Леонтьевский переулок, Комсомольская площадь, Коломенская набережная"],
    ["Ходынский б-р, Олонецкий пр-д, Кольчугинский р-н, Тульская обл.", "Ходынский бульвар, Олонецкий проезд, Кольчугинский район, Тульская область"],
    ["пос. ЛМС, мкр Солнечный, дер. Барыкино", "посёлок ЛМС, микрорайон Солнечный, деревня Барыкино"],
    ["Ленинградское ш., ш. Энтузиастов", "Ленинградское шоссе, шоссе Энтузиастов"],
    ["трасса М-2, 25 км, д. вл. 2", "трасса М-2, 25-й километр, владение 2"],
    ["МКАД, 73 км; МКАД, 68–74 км; 1,5 км от ж/д переезда", "МКАД, 73-й километр; МКАД, с 68-го по 74-й километр; 1,5 километра от железнодорожного переезда"],
    ["между ЗОК и ж/д путями, ж/д станция Вялки", "между ЗОК и железнодорожными путями, железнодорожная станция Вялки"],
    ["Горит а/м «Фольксваген», едут в а/м, вышли из а/м", "Горит машина «Фольксваген», едут в машине, вышли из машины"],
    ["Б/П, 03 не требуется", "без пострадавших, скорая не нужна"],
    ["Просит вызвать 03, звонили в 03", "Просит вызвать скорую, звонили в скорую"],
    ["Соколова Ирина, д/р 20.05.1979", "Соколова Ирина, дата рождения 20.05.1979"],
    ["т.е. горит, т.к. дым, и т.д.", "то есть горит, так как дым, и так далее"],
    ["№ 193, №5", "номер 193, номер 5"],
    ["на площади 15 кв. м, 10 м × 10 м", "на площади 15 квадратных метров, 10 метров на 10 метров"],
    ["станция скорой помощи им.А.С. Пучкова, больница им. Боткина", "станция скорой помощи имени А.С. Пучкова, больница имени Боткина"],
    ["Деп. ЖКХ, 112 по Мос. обл.", "Департамент ЖКХ, 112 по Московской области"],
  ])("%s", (written, said) => {
    expect(sayable(written)).toBe(said);
  });
});

describe("sayable: ambiguous marks are read by their neighbours", () => {
  it("«д.» — дом before a number, деревня before a name", () => {
    expect(sayable("д. 5")).toBe("дом 5");
    expect(sayable("д. Кузьминки")).toBe("деревня Кузьминки");
    expect(sayable("к д. Истомиха, у д. 5")).toBe("к деревне Истомиха, у дома 5");
  });

  it("«м.» — метро before a name, метров after a number", () => {
    expect(sayable("м. Отрадное, 50 м от выхода")).toBe("метро Отрадное, 50 метров от выхода");
    expect(sayable("отошли на 50 м. Дальше не видно")).toBe("отошли на 50 метров. Дальше не видно");
    expect(sayable("у ст. м. Отрадное")).toBe("у станции метро Отрадное");
    expect(sayable("1 м, 2 м, 21 м, 11 м")).toBe("1 метр, 2 метра, 21 метр, 11 метров");
  });

  it("«г.» — город before a name, года after a year", () => {
    expect(sayable("г. Волжский")).toBe("город Волжский");
    expect(sayable("1979 г.р.")).toBe("1979 года рождения");
    expect(sayable("в 1979 г. Потом")).toBe("в 1979 году. Потом");
  });

  it("«кв.» — квартира before a number, квадратных метров in «кв. м»", () => {
    expect(sayable("кв. 5")).toBe("квартира 5");
    expect(sayable("2 кв. м")).toBe("2 квадратных метра");
  });

  it("«03» — the ambulance, but not a door code, a time, a date or a phone", () => {
    expect(sayable("код 03, кв. 03")).toBe("код 03, квартира 03");
    expect(sayable("в 10:03, 03.05, 8-916-123-03-03")).toBe("в 10:03, 03.05, 8-916-123-03-03");
  });
});

describe("sayable: a place word takes the case its preposition asks for", () => {
  it.each([
    ["На ул. Грина горит", "На улице Грина горит"],
    ["по ул. Грина", "по улице Грина"],
    ["с ул. Мира", "с улицы Мира"],
    ["рядом с ул. Мира", "рядом с улицей Мира"],
    ["на углу ул. Мира", "на углу улицы Мира"],
    ["на пересечении ул. Ленина и ул. Мира", "на пересечении улицы Ленина и улицы Мира"],
    ["1 км до съезда на ул. Генерала Белобородова", "1 километр до съезда на улицу Генерала Белобородова"],
    ["дорога от г. Киреевск в сторону пос. Октябрьский", "дорога от города Киреевск в сторону посёлка Октябрьский"],
    ["из Некрасовки в г. Железнодорожный", "из Некрасовки в город Железнодорожный"],
    ["живу в г. Москве", "живу в городе Москве"],
    ["не доезжая пос. Бавлены", "не доезжая посёлка Бавлены"],
    ["у плотины р. Шиворонь, за р. Чеченка", "у плотины реки Шиворонь, за рекой Чеченка"],
    ["живу на Коломенской наб. Приезжайте!", "живу на Коломенской набережной. Приезжайте!"],
    ["Октябрьский Киреевского р-на", "Октябрьский Киреевского района"],
  ])("%s", (written, said) => {
    expect(sayable(written)).toBe(said);
  });
});

describe("sayable: what is not shorthand stays as it is", () => {
  it.each([
    "Я позвонила им. Сказала, что горит",
    "Д. С. Петров и А. С. Пушкин",
    "+7 (916) 123-45-67",
    "Грина 11, 2 подъезд, код 45В",
    "улица Грина, дом 11, метро Отрадное, 50 метров, скорая, 73-й километр",
    "Алло… Алло, это 112? Помогите!",
  ])("%s", (text) => {
    expect(sayable(text)).toBe(text);
  });

  it("is idempotent: a spoken line said twice does not change", () => {
    const line = "На ул. Грина, д. 11, кв. 5 горит а/м, 03 не требуется, 50 м от м. Отрадное";
    expect(sayable(sayable(line))).toBe(sayable(line));
  });
});

// ─── The reference tickets ───────────────────────────────────────────────────

type Address = { street?: string; house?: string; building?: string; structure?: string; flat?: string; entrance?: string; floor?: string; descriptive?: string };
type Row = {
  ticketRef: string;
  caller: { visibleAddress?: string; hiddenAddress?: string; situation?: string; facts?: string[]; role?: string };
  truth: { address?: Address };
};
const scenarios = readDataJson<Row[]>("scenarios.json");

/** Written shorthand that must not reach a speech synthesiser. */
const SHORTHAND =
  /(?<![\p{L}])(?:ул|д|кв|корп|стр|под|эт|пер|наб|пл|обл|пос|дер|вл|ст|им|деп|просп)\.(?=[\s\d,]|$)|(?<![\p{L}\p{N}])(?:г|м|р|ш)\.(?=\s?\p{Lu})|(?<![\p{L}])(?:пр-к?т|пр-д|р-н|б-р|мкрн?)(?![\p{L}])|а\/м|ж\/д|Б\/П|д\/р|№|(?<![\p{L}\d])км(?![\p{L}])/u;

describe("sayable on the reference tickets", () => {
  it("leaves no shorthand in anything a caller says", () => {
    const left = scenarios.flatMap((s) =>
      [s.caller.visibleAddress, s.caller.hiddenAddress, s.caller.situation, s.caller.role, ...(s.caller.facts ?? []), s.truth.address?.descriptive]
        .filter((t): t is string => !!t)
        .map((t) => sayable(t))
        .filter((t) => SHORTHAND.test(t))
        .map((t) => `${s.ticketRef}: ${t}`),
    );
    expect(left).toEqual([]);
  });

  it("keeps the address check: the street written as the caller said it matches the reference", () => {
    const streets = scenarios.map((s) => s.truth.address?.street).filter((x): x is string => !!x);
    expect(streets.length).toBeGreaterThan(50);
    for (const street of streets) {
      const said = sayable(street);
      expect([street, streetVerdict(said, street)]).toEqual([street, "same"]);
      expect([street, compareStreets(said, street)]).toEqual([street, "same"]);
      expect([street, streetKey(said)]).toEqual([street, streetKey(street)]);
    }
  });

  it("keeps the house check: «дом 21», «корпус 1» written with their words match «21» and «1»", () => {
    const labels: [keyof Address, string][] = [
      ["house", "д."],
      ["building", "корп."],
      ["structure", "стр."],
      ["flat", "кв."],
      ["entrance", "под."],
      ["floor", "эт."],
    ];
    let checked = 0;
    for (const s of scenarios) {
      const a = s.truth.address ?? {};
      for (const [key, label] of labels) {
        const value = a[key];
        if (!value) continue;
        checked++;
        expect([s.ticketRef, key, normHouse(sayable(`${label} ${value}`))]).toEqual([s.ticketRef, key, normHouse(value)]);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("reads «дом 11» and «11» as one house, and does not eat the first letter of a label", () => {
    expect(normHouse("дом 11")).toBe("11");
    expect(normHouse("строение 1")).toBe("1");
    expect(normHouse("вл. 2")).toBe("2");
    expect(normHouse("3А")).toBe("3а");
  });
});
