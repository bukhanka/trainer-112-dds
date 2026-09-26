/**
 * Development fixtures for the 112 operator place: the services the demo scenarios need and four
 * approved scenarios built from the training tickets (Б1-1, Б4-1, Б5-2, Б30-3).
 *
 * Idempotent and safe next to the reference data: services are created only when missing (the
 * classifier import owns their details), scenarios are upserted by fixed ids.
 *
 *   pnpm exec tsx prisma/dev-fixtures-op112.ts
 *
 * If the customer's full service list (sluzhby112_services.json) is found next to the repository,
 * all 211 services are created as well, so the «Добавьте службы» window is complete.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const db = new PrismaClient();

type RawService = {
  n: number;
  short: string;
  full?: string | null;
  type: string;
  subtype?: string | null;
  okrug?: string | null;
  district?: string | null;
  classifier_col?: string | null;
  select_rule?: string | null;
};

// Numbers (n) are the order of the customer's «Добавьте службы» list, used as Service.id.
const SERVICES: RawService[] = [
  { n: 1, short: "Служба 101", full: 'ГУ МЧС России по г.Москве , ГКУ "Пожарно спасательный центр" ОДС', type: "центральная", subtype: "экстренная оперативная" },
  { n: 2, short: "ФСБ", type: "центральная", subtype: "федеральная силовая" },
  { n: 3, short: "ЦЭМП", type: "центральная", subtype: "экстренная медицинская" },
  { n: 4, short: "Служба 103", full: "ГБУ города Москвы Станция скорой и неотложной медицинской помощи им.А.С. Пучкова", type: "центральная", subtype: "экстренная оперативная" },
  { n: 5, short: "Служба 104", full: 'АО "МОСГАЗ" Диспетчерское управление', type: "центральная", subtype: "экстренная оперативная" },
  { n: 7, short: "ЦОДД", full: 'ГКУ "Центр организации дорожного движения"', type: "ведомственная", subtype: "транспорт/дороги" },
  { n: 8, short: "Гормост", full: "Гормост", type: "ведомственная", subtype: "мосты/тоннели" },
  { n: 9, short: "Мосгортранс", type: "ведомственная", subtype: "транспорт" },
  { n: 14, short: "Деп. ЖКХ", full: "Департамент ЖКХ", type: "ведомственная", subtype: "городское хозяйство" },
  { n: 15, short: "Метро", type: "ведомственная", subtype: "транспорт" },
  { n: 17, short: "Мос.Без.", full: "Московская Безопасность", type: "ведомственная", subtype: "департамент" },
  { n: 21, short: "Мослифт", full: "Лифт МСК", type: "ведомственная", subtype: "городское хозяйство" },
  { n: 33, short: "ОАТИ", full: "Объединение Административно-Технических Инспекций города Москвы", type: "ведомственная", subtype: "надзор" },
  { n: 56, short: "МЖД", full: "Московская железная дорога", type: "ведомственная", subtype: "транспорт (федеральная)" },
  { n: 113, short: "Служба 102", full: "Дежурная часть ГУ МВД России по г.Москве", type: "центральная", subtype: "экстренная оперативная" },
  { n: 192, short: "Мособлгаз", full: "Мособлгаз", type: "ведомственная", subtype: "газ (МО)" },
  { n: 53, short: "Поселение Щукино", full: "ДДС района Щукино города Москвы", type: "территориальная", subtype: "район (ДДС управы района)", okrug: "СЗАО", district: "Щукино" },
  { n: 59, short: "Поселение Нагатинский Затон", full: "ДДС района Нагатинский Затон города Москвы", type: "территориальная", subtype: "район (ДДС управы района)", okrug: "ЮАО", district: "Нагатинский Затон" },
  { n: 60, short: "Поселение Дорогомилово", full: "ДДС района Дорогомилово города Москвы", type: "территориальная", subtype: "район (ДДС управы района)", okrug: "ЗАО", district: "Дорогомилово" },
  { n: 66, short: "Поселение ЮАО", full: "ДДС префектуры Южного административного округа города Москвы", type: "территориальная", subtype: "префектура (ДДС округа)", okrug: "ЮАО", district: "ЮАО" },
  { n: 71, short: "Поселение ЮЗАО", full: "ДДС префектура Юго-Западного административного округа города Москвы", type: "территориальная", subtype: "префектура (ДДС округа)", okrug: "ЮЗАО", district: "ЮЗАО" },
  { n: 156, short: "Поселение ЗАО", full: "ДДС префектуры Западного административного округа города Москвы", type: "территориальная", subtype: "префектура (ДДС округа)", okrug: "ЗАО", district: "ЗАО" },
  { n: 166, short: "Поселение СЗАО", full: "ДДС префектуры Северо-Западного административного округа города Москвы", type: "территориальная", subtype: "префектура (ДДС округа)", okrug: "СЗАО", district: "СЗАО" },
  { n: 174, short: "Поселение Северное Бутово", full: "ДДС района Северное Бутово города Москвы", type: "территориальная", subtype: "район (ДДС управы района)", okrug: "ЮЗАО", district: "Северное Бутово" },
  { n: 181, short: "Поселение ТиНАО", full: "ДДС префектуры Троицкого и Новомосковского округов города Москвы", type: "территориальная", subtype: "префектура (ДДС округа)", okrug: "ТиНАО", district: "ТиНАО" },
  { n: 191, short: "Поселение Вороновское", full: "ДДС поселения Вороновское в городе Москве", type: "территориальная", subtype: "поселение ТиНАО", okrug: "ТиНАО", district: "Вороновское" },
];

function fullServiceList(): RawService[] | null {
  const candidates = [
    process.env.SERVICES_JSON,
    path.resolve(__dirname, "../../research/materials/sluzhby112_services.json"),
    path.resolve(__dirname, "../../../research/materials/sluzhby112_services.json"),
  ].filter((p): p is string => Boolean(p));
  for (const file of candidates) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as RawService[];
  }
  return null;
}

async function seedServices() {
  const list = fullServiceList() ?? SERVICES;
  let created = 0;
  for (const s of list) {
    const exists = await db.service.findUnique({ where: { id: s.n }, select: { id: true } });
    if (exists) continue;
    await db.service.create({
      data: {
        id: s.n,
        shortName: s.short,
        fullName: s.full ?? null,
        kind: s.type,
        subtype: s.subtype ?? null,
        classifierCol: s.classifier_col ?? null,
        okrug: s.okrug ?? null,
        district: s.district ?? null,
        selectRule: s.select_rule ?? null,
        orderIdx: s.n,
      },
    });
    created++;
  }
  return { total: list.length, created };
}

const FLAME = "Открытое пламя / Дым";

type ScenarioFixture = {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  ticketRef: string;
  caller: Prisma.InputJsonValue;
  truth: Prisma.InputJsonValue;
};

const SCENARIOS: ScenarioFixture[] = [
  {
    id: "op112-dev-b1-1",
    title: "Возгорание мусорного контейнера у депо",
    category: "Пожар",
    difficulty: 3,
    ticketRef: "Б1-1",
    caller: {
      fullName: "Сидоров Иван Сергеевич",
      role: "очевидец",
      phone: "+7 (916) 126-34-71",
      visibleAddress: "Москва, депо около станции Москва-Пассажирская-Киевская, длинное здание недалеко от участкового пункта полиции",
      hiddenAddress: "МЖД Киевское направление, 1-й километр, дом 2, строение 2",
      situation: "Горит мусорный контейнер возле депо, сильно дымит. Открытое пламя, горит весь контейнер.",
      facts: ["Пострадавших нет, рядом никого.", "Огонь ни на что не перекидывается."],
      factCards: [
        { key: "situation", topic: "what", text: "Горит мусорный контейнер возле депо, сильно дымит. Открытое пламя, горит весь контейнер.", label: "что горит", expect: { kind: "tag", row: "Улица (пламя, дым)", value: "Мусор" } },
        { key: "victims", topic: "victims", text: "Пострадавших нет, рядом никого.", label: "пострадавшие", expect: { kind: "flag", flag: "victims", value: false } },
        { key: "threat", topic: "threat", text: "Огонь ни на что не перекидывается, рядом только рельсы.", label: "угроза людям", expect: { kind: "flag", flag: "threat", value: false } },
        { key: "fire", topic: "fire", text: "Да, открытое пламя, и дым чёрный.", label: "открытое пламя", expect: { kind: "tag", row: "Признак пожара (улица)", value: FLAME } },
      ],
      temper: "calm",
      voice: "male",
    },
    truth: {
      cards: ["101"],
      typeCodes: [],
      tags: [
        { card: "101", row: "Где", value: "Улица" },
        { card: "101", row: "Признак пожара (улица)", value: FLAME },
        { card: "101", row: "Улица (пламя, дым)", value: "Мусор" },
      ],
      flags: { victims: false, threat: false },
      address: { subject: "Москва", city: "Москва", street: "МЖД Киевское направление 1-й км", house: "2", structure: "2", okrug: "ЗАО", district: "Дорогомилово" },
      services: [],
      requiredQuestions: [
        { text: "Уточнить адрес: номер дома, строение, ориентиры", topic: "addressExact" },
        { text: "Есть ли пострадавшие", topic: "victims" },
        { text: "Есть ли угроза людям, распространяется ли огонь", topic: "threat" },
      ],
      callerStatus: "очевидец",
      descriptionKeywords: ["мусор|контейнер", "гор|пожар|пламя|возгоран"],
    },
  },
  {
    id: "op112-dev-b4-1",
    title: "Горит балкон на 13-м этаже",
    category: "Пожар",
    difficulty: 4,
    ticketRef: "Б4-1",
    caller: {
      fullName: "Сидорова Анна Викторовна",
      role: "очевидец",
      phone: "+7 (916) 126-34-71",
      visibleAddress: "Москва, улица Грина, номер дома не знаю, в этом доме библиотека номер 193",
      hiddenAddress: "улица Грина, дом 11",
      situation: "Горит балкон и два окна рядом на тринадцатом этаже! Открытое пламя, я с улицы вижу.",
      facts: ["Пострадавших не видно, я смотрю снизу.", "Дом 14 этажей.", "Дом газифицирован, плиты газовые."],
      factCards: [
        { key: "situation", topic: "what", text: "Горит балкон и два окна рядом на тринадцатом этаже! Открытое пламя, я с улицы вижу.", label: "что горит", expect: { kind: "tag", row: "Внутридомовые объекты (пламя, дым)", value: "Балкон" } },
        { key: "victims", topic: "victims", text: "Пострадавших не видно, я смотрю снизу.", label: "пострадавшие", expect: { kind: "flag", flag: "victims", value: false } },
        { key: "floors", topic: "floors", text: "Дом четырнадцать этажей, 14.", label: "этажность", expect: { kind: "tag", row: "Этажность здания", value: "14" } },
        { key: "gas", topic: "gas", text: "Дом газифицирован, плиты газовые.", label: "газификация", expect: { kind: "flag", flag: "gas", value: true } },
        { key: "fire", topic: "fire", text: "Открытое пламя, из окон огонь.", label: "открытое пламя", expect: { kind: "tag", row: "Признак пожара (дом)", value: FLAME } },
      ],
      temper: "panic",
      voice: "female",
    },
    truth: {
      cards: ["101"],
      typeCodes: [],
      tags: [
        { card: "101", row: "Где", value: "Дом" },
        { card: "101", row: "Признак пожара (дом)", value: FLAME },
        { card: "101", row: "Дом (пламя, дым)", value: "Дом многоквартирный" },
        { card: "101", row: "Этажность здания", value: "14" },
        { card: "101", row: "Внутридомовые объекты (пламя, дым)", value: "Балкон" },
      ],
      flags: { gas: true },
      address: { subject: "Москва", city: "Москва", street: "улица Грина", house: "11", okrug: "ЮЗАО", district: "Северное Бутово" },
      services: [],
      requiredQuestions: [
        { text: "Уточнить адрес: номер дома", topic: "addressExact" },
        { text: "Этажность здания", topic: "floors" },
        { text: "Газифицирован ли дом (обязательно)", topic: "gas" },
        { text: "Есть ли пострадавшие", topic: "victims" },
      ],
      callerStatus: "очевидец",
      descriptionKeywords: ["балкон|окн", "13|тринадцат"],
    },
  },
  {
    id: "op112-dev-b5-2",
    title: "Женщина выпила не те лекарства, без сознания",
    category: "Медицина",
    difficulty: 3,
    ticketRef: "Б5-2",
    caller: {
      fullName: "Иванов Олег Николаевич",
      role: "супруг",
      phone: "+7 (916) 897-56-23",
      visibleAddress: "Москва, Коломенская набережная, дом 18, квартира 142",
      hiddenAddress: "Коломенская набережная, дом 18, подъезд 3, этаж 4, квартира 142, код домофона 142",
      situation: "Жена выпила не те таблетки и потеряла сознание! Не отвечает мне!",
      facts: ["Без сознания, но дышит.", "Жене 51 год, Иванова Ирина Петровна, 10 марта 1975 года рождения."],
      factCards: [
        { key: "victims", topic: "victims", text: "Пострадавшая — жена, Иванова Ирина Петровна.", label: "пострадавшие", expect: { kind: "flag", flag: "victims", value: true } },
        { key: "consciousness", topic: "consciousness", text: "Без сознания, не отвечает.", label: "сознание", expect: { kind: "description", keywords: ["сознан"] } },
        { key: "breathing", topic: "breathing", text: "Дышит, но тяжело.", label: "дыхание", expect: { kind: "description", keywords: ["дыш"] } },
        { key: "age", topic: "age", text: "Ей 51 год, родилась 10 марта 1975-го.", label: "возраст", expect: { kind: "tag", row: "Возраст", value: "51" } },
      ],
      temper: "panic",
      voice: "male",
    },
    truth: {
      cards: ["103"],
      typeCodes: [],
      tags: [
        { card: "103", row: "Место", value: "Квартира" },
        { card: "103", row: "Пол", value: "Женщина" },
        { card: "103", row: "Возраст", value: "51" },
      ],
      flags: { victims: true },
      address: {
        subject: "Москва",
        city: "Москва",
        street: "Коломенская набережная",
        house: "18",
        flat: "142",
        entrance: "3",
        floor: "4",
        code: "142",
        okrug: "ЮАО",
        district: "Нагатинский Затон",
      },
      services: [],
      requiredQuestions: [
        { text: "В сознании ли пострадавшая", topic: "consciousness" },
        { text: "Дышит ли", topic: "breathing" },
        { text: "Возраст пострадавшей", topic: "age" },
        { text: "Подъезд, этаж, код домофона", keywords: ["подъезд|этаж|код|домофон"] },
      ],
      callerStatus: "родственник",
      descriptionKeywords: ["сознан", "таблет|лекарств|препарат"],
    },
  },
  {
    id: "op112-dev-b30-3",
    title: "Запах газа в частном доме, Новая Москва",
    category: "Газ",
    difficulty: 4,
    ticketRef: "Б30-3",
    caller: {
      fullName: "Соколова Вера Ивановна",
      role: "очевидец",
      phone: "+7 (916) 320-12-83",
      visibleAddress: "Новая Москва, поселение Вороновское, посёлок ЛМС, микрорайон Солнечный, дом 20",
      situation: "У меня в частном доме пахнет газом, от трубы на вводе в дом. И в трубе шумит.",
      facts: ["Газ магистральный, не баллон.", "Никто не пострадал, скорая не нужна."],
      factCards: [
        { key: "gas", topic: "gas", text: "Газ у нас магистральный, не баллон.", label: "магистральный газ", expect: { kind: "description", keywords: ["магистрал"] } },
        { key: "victims", topic: "victims", text: "Никто не пострадал, скорая не нужна.", label: "пострадавшие", expect: { kind: "flag", flag: "victims", value: false } },
      ],
      temper: "elderly",
      voice: "female",
    },
    truth: {
      cards: ["104"],
      typeCodes: [],
      tags: [
        { card: "104", row: "Признаки происшествия", value: "Запах газа в помещении (в квартире, в доме)|Запах газа вне помещения (на улице)|Повреждение газопровода" },
      ],
      flags: { victims: false },
      address: { subject: "Москва", city: "Москва", street: "посёлок ЛМС, микрорайон Солнечный", house: "20", okrug: "ТиНАО", district: "Вороновское" },
      services: [],
      requiredQuestions: [
        { text: "Магистральный газ или баллон (обязательно)", topic: "gas" },
        { text: "Есть ли пострадавшие", topic: "victims" },
      ],
      callerStatus: "очевидец",
      descriptionKeywords: ["газ", "дом|труб"],
    },
  },
];

async function seedScenarios() {
  for (const s of SCENARIOS) {
    const data = {
      title: s.title,
      category: s.category,
      difficulty: s.difficulty,
      status: "APPROVED" as const,
      source: "ticket",
      ticketRef: s.ticketRef,
      caller: s.caller,
      truth: s.truth,
      approvedSections: ["caller", "truth"],
    };
    await db.scenario.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
  }
  return SCENARIOS.length;
}

async function main() {
  const services = await seedServices();
  const scenarios = await seedScenarios();
  console.log(`op112 fixtures: services ${services.created} created of ${services.total}, scenarios ${scenarios} upserted`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
