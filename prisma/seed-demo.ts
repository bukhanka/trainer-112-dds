/**
 * Demo lessons for the teacher cabinet: two finished lessons of «Учебная группа № 1» with attempts
 * of both kinds (112 and ДДС), part of them confirmed by the teacher and part waiting for review,
 * plus a draft lesson ready to start.
 *
 *   pnpm exec tsx prisma/seed-demo.ts          finished lessons + draft
 *   pnpm exec tsx prisma/seed-demo.ts --live   also a running lesson with timers relative to now
 *
 * Run after prisma/seed.ts. Idempotent: demo lessons are deleted and rebuilt; services and
 * scenarios are upserted by id and never overwrite rows loaded by the reference seed.
 */
import { PrismaClient, type Prisma, type ServiceDelivery, type ServiceStatus } from "@prisma/client";
import { computeScore, type CriterionResult, type Weights } from "../src/lib/scoring/score";
import { ruleDraft } from "../src/lib/review/draft";

const db = new PrismaClient();

// ─── deterministic randomness ────────────────────────────────────────────────
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20260929);
const between = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
const chance = (p: number) => rnd() < p;
const at = (base: Date, sec: number) => new Date(base.getTime() + sec * 1000);
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;

// ─── reference fixtures ──────────────────────────────────────────────────────
const VORONOVSKOE = 191;
const SERVICES: { id: number; shortName: string; fullName: string; kind: string; delivery: ServiceDelivery; okrug?: string; district?: string }[] = [
  { id: 1, shortName: "Служба 101", fullName: "ГУ МЧС России по г. Москве, пожарно-спасательный центр", kind: "центральная", delivery: "VIS" },
  { id: 3, shortName: "ЦЭМП", fullName: "Центр экстренной медицинской помощи", kind: "центральная", delivery: "ARM112" },
  { id: 4, shortName: "Служба 103", fullName: "Станция скорой и неотложной медицинской помощи", kind: "центральная", delivery: "VIS" },
  { id: 5, shortName: "Служба 104", fullName: "АО «МОСГАЗ», диспетчерское управление", kind: "центральная", delivery: "VIS" },
  { id: 14, shortName: "Деп. ЖКХ", fullName: "Департамент ЖКХ", kind: "ведомственная", delivery: "PHONE" },
  { id: 21, shortName: "Мослифт", fullName: "Лифт МСК", kind: "ведомственная", delivery: "ARM112" },
  { id: 53, shortName: "Поселение Щукино", fullName: "ДДС района Щукино", kind: "территориальная", delivery: "ARM112", okrug: "СЗАО", district: "Щукино" },
  { id: 113, shortName: "Служба 102", fullName: "Дежурная часть ГУ МВД России по г. Москве", kind: "центральная", delivery: "VIS" },
  { id: 181, shortName: "Поселение ТиНАО", fullName: "ДДС префектуры ТиНАО", kind: "территориальная", delivery: "ARM112", okrug: "ТиНАО", district: "ТиНАО" },
  { id: VORONOVSKOE, shortName: "Поселение Вороновское", fullName: "ДДС поселения Вороновское", kind: "территориальная", delivery: "ARM112", okrug: "ТиНАО", district: "Вороновское" },
];

type Fixture = {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  status: "APPROVED" | "DRAFT";
  approvedSections: string[];
  caller: Prisma.InputJsonValue;
  truth: Prisma.InputJsonValue;
  ddsCard: Prisma.InputJsonValue;
  ddsReference: Prisma.InputJsonValue;
  // demo-only hints for the simulation below
  services: number[];
  decision: "accept" | "reject";
  typeLabel: string;
  address: string;
  description: string;
  question?: string;
};

const ALL_SECTIONS = ["caller", "truth", "ddsCard", "ddsReference"];

const SCENARIOS: Fixture[] = [
  {
    id: "demo-gas-lms",
    title: "Запах газа у ввода в частный дом",
    category: "Газ",
    difficulty: 4,
    status: "APPROVED",
    approvedSections: ALL_SECTIONS,
    caller: {
      fullName: "Соколова Вера Ивановна",
      role: "хозяйка дома",
      phone: "916-320-12-83",
      visibleAddress: "посёлок ЛМС, дом 20",
      hiddenAddress: "Новая Москва, поселение Вороновское, пос. ЛМС, мкр. Солнечный, дом 20",
      situation: "У трубы на вводе в дом сильно пахнет газом и слышно шипение",
      facts: ["Газ магистральный", "В доме двое взрослых, все на улице", "Скорая не нужна"],
      temper: "panic",
      voice: "female",
    },
    truth: {
      finalType: "газ: запах газа (частный дом)",
      flags: { gas: true, threat: true },
      address: { okrug: "ТиНАО", district: "Вороновское", street: "мкр. Солнечный", house: "20" },
      services: ["Служба 104", "Служба 101", "Поселение Вороновское", "Поселение ТиНАО"],
      requiredQuestions: ["Газ магистральный или в баллонах?", "Есть ли люди в доме?"],
    },
    ddsCard: { type: "Газ", description: "Запах газа у ввода в частный дом, шум в трубе. Газ магистральный. Люди эвакуировались сами." },
    ddsReference: {
      "Поселение Вороновское": {
        decision: "accept",
        chain: ["Принята", "Начало реагирования", "Прибытие", "Проведение работ", "Работы завершены"],
        mustMention: ["номер наряда", "что сделано на месте"],
      },
    },
    services: [5, 1, VORONOVSKOE, 181],
    decision: "accept",
    typeLabel: "Газ",
    address: "Москва, (ТАО, Вороновское), пос. ЛМС, мкр. Солнечный, д. 20",
    description: "Запах газа у ввода в дом, слышен шум в трубе. Газ магистральный. Люди на улице.",
    question: "газ магистральный или баллонный",
  },
  {
    id: "demo-flood-heating",
    title: "Прорыв трубы отопления в подъезде",
    category: "ЖКХ",
    difficulty: 3,
    status: "APPROVED",
    approvedSections: ALL_SECTIONS,
    caller: {
      fullName: "Кравцов Игорь Семёнович",
      role: "житель дома",
      phone: "903-226-13-83",
      visibleAddress: "Вороново, дом 5",
      hiddenAddress: "поселение Вороновское, с. Вороново, ул. Школьная, д. 5, подъезд 2",
      situation: "В подъезде прорвало трубу отопления, горячая вода заливает лестницу и квартиры первого этажа",
      facts: ["Пострадавших нет", "Пар, плохо видно", "Управляющая компания не отвечает"],
      temper: "angry",
      voice: "male",
    },
    truth: {
      finalType: "ЖКХ: прорыв трубы отопления",
      flags: { threat: false },
      address: { okrug: "ТиНАО", district: "Вороновское", street: "ул. Школьная", house: "5", entrance: "2" },
      services: ["Поселение Вороновское", "Поселение ТиНАО", "Деп. ЖКХ"],
      requiredQuestions: ["Есть ли пострадавшие?", "Какой подъезд и этаж?"],
    },
    ddsCard: { type: "ЖКХ", description: "Прорыв трубы отопления во 2-м подъезде, заливает квартиры 1-го этажа, пар." },
    ddsReference: {
      "Поселение Вороновское": {
        decision: "accept",
        chain: ["Принята", "Начало реагирования", "Прибытие", "Проведение работ", "Работы завершены"],
        mustMention: ["перекрытие стояка", "номер наряда"],
      },
    },
    services: [VORONOVSKOE, 181, 14],
    decision: "accept",
    typeLabel: "ЖКХ",
    address: "Москва, (ТАО, Вороновское), с. Вороново, ул. Школьная, д. 5, под. 2",
    description: "Прорыв трубы отопления во 2-м подъезде, заливает 1-й этаж, пар на лестнице. Пострадавших нет.",
  },
  {
    id: "demo-lift-child",
    title: "Застряли в лифте с ребёнком",
    category: "ЖКХ",
    difficulty: 2,
    status: "APPROVED",
    approvedSections: ALL_SECTIONS,
    caller: {
      fullName: "Лебедева Анна Олеговна",
      role: "мама",
      phone: "916-896-32-54",
      visibleAddress: "Солнечный, дом 3",
      hiddenAddress: "поселение Вороновское, пос. ЛМС, мкр. Солнечный, д. 3, подъезд 1",
      situation: "Застряла в лифте между 4 и 5 этажом с ребёнком 4 лет, ребёнок плачет",
      facts: ["Свет в кабине есть", "Никто не травмирован", "Кнопка связи с диспетчером не работает"],
      temper: "panic",
      voice: "female",
    },
    truth: {
      finalType: "лифт: застревание людей",
      flags: { threat: true },
      address: { okrug: "ТиНАО", district: "Вороновское", street: "мкр. Солнечный", house: "3", entrance: "1" },
      services: ["Мослифт", "Поселение Вороновское", "Поселение ТиНАО"],
      requiredQuestions: ["Сколько человек в кабине, есть ли дети?", "Есть ли травмы?"],
    },
    ddsCard: { type: "Лифт", description: "Застряли в лифте женщина и ребёнок 4 лет между 4 и 5 этажами, 1-й подъезд." },
    ddsReference: {
      "Поселение Вороновское": {
        decision: "accept",
        chain: ["Принята", "Начало реагирования", "Прибытие", "Работы завершены"],
        mustMention: ["кто освободил", "время освобождения"],
      },
    },
    services: [21, VORONOVSKOE, 181],
    decision: "accept",
    typeLabel: "Лифт",
    address: "Москва, (ТАО, Вороновское), пос. ЛМС, мкр. Солнечный, д. 3, под. 1",
    description: "В лифте застряли женщина и ребёнок 4 лет, между 4 и 5 этажами. Травм нет.",
  },
  {
    id: "demo-fire-container",
    title: "Горит мусорный контейнер у дома",
    category: "Пожар",
    difficulty: 2,
    status: "APPROVED",
    approvedSections: ALL_SECTIONS,
    caller: {
      fullName: "Сидоров Иван Сергеевич",
      role: "очевидец",
      phone: "916-126-34-71",
      visibleAddress: "Щукинская улица, 12",
      hiddenAddress: "ул. Щукинская, д. 12, во дворе у контейнерной площадки",
      situation: "Во дворе горит мусорный контейнер, огонь высокий, рядом машины",
      facts: ["Пострадавших нет", "До дома метров десять"],
      temper: "calm",
      voice: "male",
    },
    truth: {
      finalType: "пожар: мусор",
      flags: {},
      address: { okrug: "СЗАО", district: "Щукино", street: "ул. Щукинская", house: "12" },
      services: ["Служба 101", "Поселение Щукино"],
      requiredQuestions: ["Есть ли угроза зданиям и машинам?"],
    },
    ddsCard: { type: "Пожар", description: "Горит мусорный контейнер во дворе, рядом припаркованы машины." },
    ddsReference: {
      "Поселение Вороновское": {
        decision: "reject",
        mustMention: ["не наша территория", "кому передано: Поселение Щукино"],
      },
    },
    services: [1, 53, VORONOVSKOE],
    decision: "reject",
    typeLabel: "101",
    address: "Москва, ул. Щукинская, д. 12, двор (СЗАО, Щукино)",
    description: "Горит мусорный контейнер во дворе, рядом машины. Пострадавших нет.",
  },
  {
    id: "demo-dtp-victims",
    title: "ДТП с пострадавшим на Калужском шоссе",
    category: "ДТП",
    difficulty: 5,
    status: "APPROVED",
    approvedSections: ALL_SECTIONS,
    caller: {
      fullName: "Иванова Елена Сергеевна",
      role: "водитель",
      phone: "916-897-56-23",
      visibleAddress: "Калужское шоссе, у поворота на Вороново",
      hiddenAddress: "Калужское шоссе, 64-й км, поворот на с. Вороново, поселение Вороновское",
      situation: "Столкнулись две машины, у пассажира кровь на голове, из бака течёт бензин",
      facts: ["Один пострадавший, в сознании", "Машины перекрыли правую полосу", "Бензин растекается"],
      temper: "panic",
      voice: "female",
    },
    truth: {
      finalType: "ДТП: с пострадавшими, разлив топлива",
      flags: { victims: true, traffic: true, threat: true },
      address: { okrug: "ТиНАО", district: "Вороновское", street: "Калужское ш., 64-й км" },
      services: ["Служба 103", "Служба 102", "Служба 101", "ЦЭМП", "Поселение Вороновское", "Поселение ТиНАО"],
      requiredQuestions: ["Сколько пострадавших, в сознании ли?", "Есть ли разлив топлива, возгорание?"],
    },
    ddsCard: { type: "ДТП", description: "ДТП, 2 автомобиля, 1 пострадавший (травма головы), разлив бензина, перекрыта правая полоса." },
    ddsReference: {
      "Поселение Вороновское": {
        decision: "accept",
        chain: ["Принята", "Начало реагирования", "Прибытие", "Проведение работ", "Работы завершены"],
        mustMention: ["пострадавшие", "засыпка разлива"],
      },
    },
    services: [4, 113, 1, 3, VORONOVSKOE, 181],
    decision: "accept",
    typeLabel: "ДТП",
    address: "Москва, (ТАО, Вороновское), Калужское ш., 64-й км, поворот на с. Вороново",
    description: "ДТП, 2 а/м, пострадавший пассажир с травмой головы, разлив бензина, перекрыта правая полоса.",
    question: "есть ли пострадавшие и в каком состоянии",
  },
  {
    id: "demo-tree-car",
    title: "Упало дерево на припаркованную машину",
    category: "ЖКХ",
    difficulty: 3,
    status: "DRAFT",
    approvedSections: ["caller"],
    caller: {
      fullName: "Морозова Ирина Павловна",
      role: "владелец машины",
      phone: "926-555-10-20",
      visibleAddress: "Вороново, у школы",
      hiddenAddress: "с. Вороново, ул. Школьная, д. 1, парковка у школы",
      situation: "После ветра упало дерево на мою машину, провода не задеты",
      facts: ["Людей в машине не было", "Дерево перекрыло проезд к школе"],
      temper: "angry",
      voice: "female",
    },
    truth: {
      finalType: "ЖКХ: падение дерева",
      flags: { traffic: true },
      address: { okrug: "ТиНАО", district: "Вороновское", street: "ул. Школьная", house: "1" },
      services: ["Поселение Вороновское", "Поселение ТиНАО"],
      requiredQuestions: ["Задеты ли провода?", "Есть ли пострадавшие?"],
    },
    ddsCard: { type: "ЖКХ", description: "Упало дерево на автомобиль, перекрыт проезд к школе. Пострадавших нет." },
    ddsReference: {
      "Поселение Вороновское": { decision: "accept", chain: ["Принята", "Начало реагирования", "Работы завершены"], mustMention: ["распил и вывоз"] },
    },
    services: [VORONOVSKOE, 181],
    decision: "accept",
    typeLabel: "ЖКХ",
    address: "Москва, (ТАО, Вороновское), с. Вороново, ул. Школьная, д. 1",
    description: "Упало дерево на припаркованный автомобиль, перекрыт проезд к школе.",
  },
];

// ─── student profiles: who is strong and where the weak ones fail ───────────
type Profile = {
  ack: [number, number]; // seconds to «Принята»
  dispatch: [number, number]; // seconds to «Начало реагирования»
  typing: [number, number]; // seconds to save a 112 card
  skipProgress: number;
  noHandover: number;
  lookAlikeStreet: number;
  sloppyText: number;
  wrongDecision: number;
  missQuestion: number;
  wrongServices: number;
};
const PROFILES: Record<string, Profile> = {
  student1: { ack: [12, 24], dispatch: [80, 150], typing: [44, 60], skipProgress: 0, noHandover: 0, lookAlikeStreet: 0, sloppyText: 0, wrongDecision: 0, missQuestion: 0.1, wrongServices: 0 },
  student2: { ack: [18, 32], dispatch: [100, 170], typing: [52, 70], skipProgress: 0.2, noHandover: 0.2, lookAlikeStreet: 0, sloppyText: 0.2, wrongDecision: 0, missQuestion: 0.2, wrongServices: 0.2 },
  student3: { ack: [26, 58], dispatch: [140, 260], typing: [66, 98], skipProgress: 0.4, noHandover: 0.4, lookAlikeStreet: 0.7, sloppyText: 0.5, wrongDecision: 0.3, missQuestion: 0.5, wrongServices: 0.4 },
  student4: { ack: [16, 30], dispatch: [110, 190], typing: [55, 75], skipProgress: 0.2, noHandover: 0.8, lookAlikeStreet: 0.1, sloppyText: 0.3, wrongDecision: 0, missQuestion: 0.3, wrongServices: 0.1 },
  student5: { ack: [34, 75], dispatch: [150, 240], typing: [60, 90], skipProgress: 0.6, noHandover: 0.5, lookAlikeStreet: 0.3, sloppyText: 0.4, wrongDecision: 0.2, missQuestion: 0.4, wrongServices: 0.3 },
};

const LOOK_ALIKE: Record<string, [string, string]> = {
  "demo-gas-lms": ["мкр. Солнечный", "мкр. Солнечная"],
  "demo-flood-heating": ["ул. Школьная", "ул. Шкалова"],
  "demo-lift-child": ["мкр. Солнечный", "мкр. Солнцево"],
  "demo-fire-container": ["ул. Щукинская", "ул. Щуко"],
  "demo-dtp-victims": ["Калужское ш.", "Каширское ш."],
};

const HANDOVER_OK = "Не принята: адрес вне зоны обслуживания поселения. Передано в ДДС района Щукино (по телефону, дежурный Орлов)";
const HANDOVER_BAD = "Не наша территория";

type Ctx = { weights: Weights; teacherId: string; ackSec: number; workSec: number; typingSec: number };

type Event = { status: ServiceStatus; sec: number; comment?: string; crew?: string };

type Review = "CONFIRMED" | "OVERRIDDEN" | "PENDING";

// ─── ДДС: one plate handled at a seat ────────────────────────────────────────
function simulateDds(fx: Fixture, p: Profile, ctx: Ctx, cut: number | null) {
  const events: Event[] = [{ status: "RECEIVED", sec: between(3, 8) }];
  const crits: CriterionResult[] = [];
  const ack = between(p.ack[0], p.ack[1]);
  const wrongDecision = chance(p.wrongDecision);
  const decision = wrongDecision ? (fx.decision === "accept" ? "reject" : "accept") : fx.decision;
  const crew = String(between(11, 48));
  const sloppy = chance(p.sloppyText);
  const skip = chance(p.skipProgress);

  if (decision === "reject") {
    const good = !chance(p.noHandover);
    events.push({ status: "REJECTED", sec: ack, comment: good ? HANDOVER_OK : HANDOVER_BAD });
  } else {
    events.push({ status: "ACCEPTED", sec: ack, crew, comment: sloppy ? "отпр бр" : `Направлена аварийная бригада, наряд ${crew}` });
    const dispatch = between(p.dispatch[0], p.dispatch[1]);
    events.push({ status: "STARTED", sec: dispatch, crew, comment: sloppy ? "выехали" : "Бригада выехала на место" });
    if (!skip) {
      events.push({ status: "ARRIVED", sec: dispatch + between(240, 420), crew, comment: "Бригада прибыла на место" });
      events.push({ status: "WORKING", sec: dispatch + between(480, 600), crew, comment: "Проводятся работы" });
    }
    events.push({
      status: "FINISHED",
      sec: dispatch + between(720, 960),
      crew,
      comment: sloppy ? "Сделано" : "Работы завершены: аварийный участок отключён, опасности для жителей нет",
    });
  }
  // A lesson may end before the brigade finishes: those plates stay «Не завершено».
  const kept = cut == null ? events : events.filter((e) => e.sec <= cut);

  const ackEvent = kept.find((e) => e.status === "ACCEPTED" || e.status === "REJECTED");
  crits.push({
    code: "dds.ack_in_time",
    group: "timeliness",
    title: "Ответ «Принята» / «Не принята» за 30 с",
    ok: ackEvent ? ackEvent.sec <= ctx.ackSec : false,
    evidence: ackEvent ? `«${ackEvent.status === "ACCEPTED" ? "Принята" : "Не принята"}» через ${mmss(ackEvent.sec)} после «Добавлена»` : "Ответа нет",
    expected: `не позже ${mmss(ctx.ackSec)}`,
    source: "rule",
  });
  const started = kept.find((e) => e.status === "STARTED");
  crits.push({
    code: "dds.dispatch_in_time",
    group: "timeliness",
    title: "Наряд отправлен за 3 мин",
    ok: decision === "reject" ? null : started ? started.sec <= ctx.workSec : false,
    evidence: started ? `«Начало реагирования» через ${mmss(started.sec)}` : decision === "reject" ? undefined : "Статуса «Начало реагирования» нет",
    expected: `не позже ${mmss(ctx.workSec)}`,
    source: "rule",
  });
  if (decision === "accept") {
    const finished = kept.some((e) => e.status === "FINISHED");
    crits.push({
      code: "dds.progress_statuses",
      group: "statusOrder",
      title: "Статусы хода работ по докладам бригады",
      ok: !skip,
      evidence: skip ? "Бригада доложила о прибытии и начале работ, статусы «Прибытие» и «Проведение работ» не выставлены" : "Все доклады отражены статусами",
      expected: "Принята → Начало реагирования → Прибытие → Проведение работ → Работы завершены",
      source: "rule",
    });
    crits.push({
      code: "dds.closed",
      group: "statusOrder",
      title: "Карточка закрыта статусом «Работы завершены»",
      ok: finished,
      evidence: finished ? undefined : "К концу занятия нет «Работы завершены»",
      expected: "закрыть карточку итоговым статусом с результатом работ",
      source: "rule",
    });
    crits.push({
      code: "dds.final_comment",
      group: "comments",
      title: "Итог работ в комментарии",
      ok: finished ? !sloppy : null,
      evidence: finished ? `Комментарий: «${sloppy ? "Сделано" : "Работы завершены: аварийный участок отключён…"}»` : undefined,
      expected: "что сделано и в каком состоянии объект",
      source: "rule",
    });
  }
  const rejected = kept.find((e) => e.status === "REJECTED");
  crits.push({
    code: "dds.reject_comment",
    group: "comments",
    title: "Комментарий к «Не принята»: причина и кому передано",
    ok: rejected ? rejected.comment === HANDOVER_OK : null,
    evidence: rejected ? `Комментарий: «${rejected.comment}»` : undefined,
    expected: "причина и кому передано (служба, фамилия дежурного)",
    source: "rule",
  });
  crits.push({
    code: "dds.decision",
    group: "services",
    title: fx.decision === "accept" ? "Профильное происшествие принято" : "Чужая территория: не принята",
    ok: !wrongDecision,
    evidence: wrongDecision
      ? fx.decision === "accept"
        ? "«Не принята: не наш профиль» — адрес в зоне поселения, реагирование обязательно"
        : "«Принята», хотя адрес в зоне другого района"
      : undefined,
    expected: fx.decision === "accept" ? "Принята, направить бригаду" : "Не принята с комментарием, кому передано",
    critical: fx.decision === "accept",
    source: "rule",
  });
  crits.push({
    code: "dds.text_clear",
    group: "literacy",
    title: "Комментарии понятны следующему диспетчеру",
    ok: !sloppy,
    evidence: sloppy ? "«отпр бр», «выехали» — непонятно, кто и куда" : undefined,
    expected: "Полные фразы: кто направлен, номер наряда, что делают",
    source: "ai",
  });
  return { events: kept, crits, decision };
}

// ─── 112: a card filled at a seat ────────────────────────────────────────────
function simulate112(fx: Fixture, p: Profile, ctx: Ctx) {
  const typing = between(p.typing[0], p.typing[1]);
  const lookAlike = chance(p.lookAlikeStreet) && LOOK_ALIKE[fx.id];
  const missQuestion = Boolean(fx.question) && chance(p.missQuestion);
  const wrongServices = chance(p.wrongServices);
  const sloppy = chance(p.sloppyText);
  const caller = fx.caller as { fullName: string; situation: string; hiddenAddress: string; visibleAddress: string };
  const crits: CriterionResult[] = [
    {
      code: "op112.typing_time",
      group: "timeliness",
      title: "Карточка сохранена до красного таймера",
      ok: typing <= ctx.typingSec,
      evidence: `Карточка сохранена через ${mmss(typing)}`,
      expected: `не позже ${mmss(ctx.typingSec)}`,
      source: "rule",
    },
    {
      code: "op112.address_street",
      group: "address",
      title: "Улица записана верно",
      ok: !lookAlike,
      critical: true,
      evidence: lookAlike ? `Заявитель: «${lookAlike[0]}»; в карточке: «${lookAlike[1]}»` : undefined,
      expected: lookAlike ? `${lookAlike[0]} — похожая улица отправит бригаду по другому адресу` : undefined,
      source: "rule",
    },
    {
      code: "op112.address_clarified",
      group: "address",
      title: "Адрес уточнён до дома и ориентира",
      ok: !(lookAlike && chance(0.5)),
      evidence: `Заявитель сначала сказал «${caller.visibleAddress}»`,
      expected: caller.hiddenAddress,
      source: "rule",
    },
    {
      code: "op112.services",
      group: "services",
      title: "Службы выбраны верно",
      ok: !wrongServices,
      evidence: wrongServices ? "Не добавлена служба «Поселение ТиНАО» (ДДС префектуры округа)" : undefined,
      expected: "ДДС поселения + ДДС префектуры округа + профильные службы",
      source: "rule",
    },
    {
      code: "op112.questions",
      group: "completeness",
      title: "Обязательные вопросы опросной карты",
      ok: fx.question ? !missQuestion : null,
      evidence: missQuestion ? `Не спросил: ${fx.question}` : undefined,
      expected: fx.question ? `Спросить: ${fx.question}` : undefined,
      source: "rule",
    },
    {
      code: "op112.said_vs_filled",
      group: "completeness",
      title: "Сказанное заявителем совпадает с карточкой",
      ok: !(missQuestion && chance(0.6)),
      evidence: `Заявитель: «${caller.situation}»`,
      expected: "Все факты из разговора перенесены в описание и признаки",
      source: "ai",
    },
    {
      code: "op112.description_clear",
      group: "literacy",
      title: "Описание понятно службе",
      ok: !sloppy,
      evidence: sloppy ? "«запах газ у трубы дом 20 срочн»" : undefined,
      expected: "Коротко и полно: что случилось, где, есть ли угроза людям",
      source: "ai",
    },
  ];
  return { typing, crits, lookAlike };
}

function dialogue(fx: Fixture, start: Date) {
  const c = fx.caller as { fullName: string; situation: string; visibleAddress: string; hiddenAddress: string; facts: string[] };
  const lines: [string, string][] = [
    ["trainee", "Служба 112, что у вас случилось?"],
    ["counterpart", c.situation],
    ["trainee", "Назовите адрес."],
    ["counterpart", c.visibleAddress],
    ["trainee", "Уточните населённый пункт и дом."],
    ["counterpart", c.hiddenAddress],
    ["trainee", "Как вас зовут?"],
    ["counterpart", c.fullName],
    ["counterpart", c.facts[0] ?? ""],
    ["trainee", "Информация принята, службы оповещены."],
  ];
  return lines.filter(([, t]) => t).map(([role, text], i) => ({ role, text, at: at(start, 4 + i * 6).toISOString() }));
}

// ─── lesson builder ──────────────────────────────────────────────────────────
type SeatPlan = { login: string; role: "OP112" | "DDS"; tasks: string[] };

async function buildLesson(opts: {
  id: string;
  title: string;
  status: "FINISHED" | "RUNNING" | "DRAFT";
  start: Date;
  durationMin: number;
  plan: SeatPlan[];
  settings: Record<string, unknown>;
  review: (i: number, total: number) => Review;
  ctx: Ctx;
  groupId: string;
}) {
  const { ctx } = opts;
  const students = await db.user.findMany({ where: { login: { in: opts.plan.map((p) => p.login) } } });
  const byLogin = new Map(students.map((s) => [s.login, s]));
  const finishedAt = opts.status === "FINISHED" ? at(opts.start, opts.durationMin * 60) : null;

  await db.lesson.create({
    data: {
      id: opts.id,
      title: opts.title,
      teacherId: ctx.teacherId,
      groupId: opts.groupId,
      status: opts.status,
      settings: opts.settings as Prisma.InputJsonValue,
      startedAt: opts.status === "DRAFT" ? null : opts.start,
      finishedAt,
      createdAt: at(opts.start, -3600),
    },
  });

  const seats = [];
  for (const [i, p] of opts.plan.entries()) {
    const student = byLogin.get(p.login);
    if (!student) continue;
    seats.push(
      await db.seat.create({
        data: {
          lessonId: opts.id,
          studentId: student.id,
          role: p.role,
          serviceId: p.role === "DDS" ? VORONOVSKOE : null,
          scenarioIds: p.tasks,
          label: `Место ${i + 1}`,
          createdAt: at(opts.start, -3600 + i),
        },
      }),
    );
  }
  if (opts.status === "DRAFT") return { attempts: 0 };

  const fixtures = new Map(SCENARIOS.map((s) => [s.id, s]));
  const lessonEndSec = opts.durationMin * 60;
  const attempts: Prisma.AttemptCreateManyInput[] = [];
  const ddsSeats = seats.filter((s) => s.role === "DDS");
  let ddsTurn = 0;
  // Cards typed at 112 places reach the ДДС places only when the lesson takes students' cards.
  const routeToDds = opts.settings.cardSource !== "generated";

  // One place after another, cards spaced by the lesson tempo.
  for (const seat of seats) {
    const login = students.find((s) => s.id === seat.studentId)!.login;
    const profile = PROFILES[login] ?? PROFILES.student2;
    const plan = opts.plan.find((p) => p.login === login)!;

    for (const [k, taskId] of plan.tasks.entries()) {
      const fx = fixtures.get(taskId)!;
      const offset = 120 + k * between(540, 660) + between(0, 40);
      const t0 = at(opts.start, offset);
      const cut = finishedAt ? lessonEndSec - offset : null;

      if (seat.role === "OP112") {
        const sim = simulate112(fx, profile, ctx);
        const incident = await db.incident.create({
          data: {
            lessonId: opts.id,
            scenarioId: fx.id,
            source: "op112",
            createdBySeatId: seat.id,
            operatorNo: String(900 + seats.indexOf(seat)),
            armNo: String(seats.indexOf(seat) + 1),
            status: "worked",
            caller: { fullName: (fx.caller as { fullName: string }).fullName, status: "очевидец", aon: (fx.caller as { phone: string }).phone },
            address: { descriptive: sim.lookAlike ? fx.address.replace(sim.lookAlike[0], sim.lookAlike[1]) : fx.address },
            flags: ((fx.truth as { flags?: Prisma.InputJsonValue }).flags ?? {}) as Prisma.InputJsonValue,
            description: fx.description,
            descriptionLog: [{ at: at(t0, sim.typing).toISOString(), author: `оп. ${900 + seats.indexOf(seat)}`, text: fx.description }],
            openedAt: t0,
            savedAt: at(t0, sim.typing),
            workedAt: at(t0, sim.typing + 40),
            createdAt: t0,
          },
        });
        await db.call.create({
          data: {
            lessonId: opts.id,
            seatId: seat.id,
            incidentId: incident.id,
            kind: "CALLER_IN",
            status: "ENDED",
            counterpart: { name: (fx.caller as { fullName: string }).fullName, role: "заявитель", voice: (fx.caller as { voice?: string }).voice ?? "female" },
            messages: dialogue(fx, t0),
            startedAt: at(t0, -5),
            answeredAt: t0,
            endedAt: at(t0, 70),
          },
        });
        // Plates of the created card; the ДДС plate goes to a ДДС place of the same lesson.
        const target = ddsSeats.length ? ddsSeats[ddsTurn++ % ddsSeats.length] : null;
        for (const serviceId of fx.services) {
          const addedAt = at(t0, sim.typing + 1);
          const plate = await db.incidentService.create({
            data: { incidentId: incident.id, serviceId, isMain: serviceId === fx.services[0], addedBy: "auto", status: "ADDED", addedAt },
          });
          const delivered = serviceId === VORONOVSKOE && target && routeToDds ? target.id : null;
          // The ADDED event records the place the card was delivered to.
          const events: Prisma.StatusEventCreateManyInput[] = [
            { incidentServiceId: plate.id, status: "ADDED", actorLabel: "система", seatId: delivered, at: addedAt },
          ];
          if (delivered && target) {
            const tLogin = students.find((s) => s.id === target.studentId)!.login;
            const tProfile = PROFILES[tLogin] ?? PROFILES.student2;
            const remaining = finishedAt ? lessonEndSec - (offset + sim.typing + 1) : null;
            const dds = simulateDds(fx, tProfile, ctx, remaining);
            const actor = students.find((s) => s.id === target.studentId)!.fullName;
            for (const e of dds.events) {
              events.push({
                incidentServiceId: plate.id,
                status: e.status,
                comment: e.comment,
                crewNumber: e.crew,
                actorLabel: actor,
                actorUserId: target.studentId,
                seatId: target.id,
                late: e.status === "ACCEPTED" || e.status === "REJECTED" ? e.sec > ctx.ackSec : false,
                at: at(addedAt, e.sec),
              });
            }
            const last = dds.events[dds.events.length - 1];
            await db.incidentService.update({ where: { id: plate.id }, data: { status: last?.status ?? "ADDED", crewNumber: dds.events.find((e) => e.crew)?.crew } });
            attempts.push(attemptRow(opts.id, target, "DDS", incident.id, plate.id, fx.id, dds.crits, at(addedAt, (last?.sec ?? 0) + 5), ctx));
          } else {
            const bot = botEvents(serviceId, addedAt, plate.id);
            events.push(...bot.events);
            if (bot.last) await db.incidentService.update({ where: { id: plate.id }, data: { status: bot.last } });
          }
          await db.statusEvent.createMany({ data: events });
        }
        attempts.push(attemptRow(opts.id, seat, "OP112", incident.id, null, fx.id, sim.crits, at(t0, sim.typing + 5), ctx));
      } else {
        // A generated card delivered straight to this ДДС place.
        const incident = await db.incident.create({
          data: {
            lessonId: opts.id,
            scenarioId: fx.id,
            source: "generated",
            operatorNo: "0",
            armNo: "4",
            status: "registered",
            caller: { fullName: (fx.caller as { fullName: string }).fullName, status: "очевидец" },
            address: { descriptive: fx.address },
            flags: ((fx.truth as { flags?: Prisma.InputJsonValue }).flags ?? {}) as Prisma.InputJsonValue,
            description: fx.description,
            descriptionLog: [{ at: t0.toISOString(), author: "0 УМЦ О.п.", text: fx.description }],
            savedAt: t0,
            createdAt: t0,
          },
        });
        const dds = simulateDds(fx, profile, ctx, cut);
        const student = students.find((s) => s.id === seat.studentId)!;
        for (const serviceId of fx.services) {
          const plate = await db.incidentService.create({
            data: { incidentId: incident.id, serviceId, isMain: serviceId === fx.services[0], addedBy: "auto", addedAt: t0 },
          });
          const events: Prisma.StatusEventCreateManyInput[] = [
            { incidentServiceId: plate.id, status: "ADDED", actorLabel: "система", seatId: serviceId === VORONOVSKOE ? seat.id : null, at: t0 },
          ];
          if (serviceId === VORONOVSKOE) {
            for (const e of dds.events) {
              events.push({
                incidentServiceId: plate.id,
                status: e.status,
                comment: e.comment,
                crewNumber: e.crew,
                actorLabel: student.fullName,
                actorUserId: student.id,
                seatId: seat.id,
                late: e.status === "ACCEPTED" || e.status === "REJECTED" ? e.sec > ctx.ackSec : false,
                at: at(t0, e.sec),
              });
            }
            const last = dds.events[dds.events.length - 1];
            await db.incidentService.update({ where: { id: plate.id }, data: { status: last?.status ?? "ADDED", crewNumber: dds.events.find((e) => e.crew)?.crew } });
            attempts.push(attemptRow(opts.id, seat, "DDS", incident.id, plate.id, fx.id, dds.crits, at(t0, (last?.sec ?? 0) + 5), ctx));
          } else {
            const bot = botEvents(serviceId, t0, plate.id);
            events.push(...bot.events);
            if (bot.last) await db.incidentService.update({ where: { id: plate.id }, data: { status: bot.last } });
          }
          await db.statusEvent.createMany({ data: events });
        }
      }
    }
  }

  // Review state: the teacher confirmed the earlier attempts; some checks were corrected.
  attempts.sort((a, b) => new Date(a.createdAt as Date).getTime() - new Date(b.createdAt as Date).getTime());
  for (const [i, a] of attempts.entries()) {
    const review = opts.review(i, attempts.length);
    const criteria = a.criteria as unknown as CriterionResult[];
    if (review === "PENDING") continue;
    a.reviewStatus = review;
    a.reviewedById = ctx.teacherId;
    a.reviewedAt = at(finishedAt ?? opts.start, 600 + i * 45);
    if (review === "OVERRIDDEN") {
      // The teacher disagrees with the AI check on text: short dispatcher abbreviations are acceptable.
      const target = criteria.find((c) => c.source === "ai" && c.ok === false) ?? criteria.find((c) => c.source === "ai");
      if (target) {
        a.override = { [target.code]: !target.ok };
        a.teacherComment = target.ok
          ? "ИИ не заметил: в описании нет главного — есть ли угроза людям. Засчитываю как ошибку."
          : "Сокращения понятны любому диспетчеру ДДС, смысл передан. Засчитываю.";
      }
    } else if (criteria.some((c) => c.ok === false)) {
      a.teacherComment = "Разобрали на занятии. Обратите внимание на ошибки ниже.";
    }
    a.score = computeScore(criteria, ctx.weights, a.override as Record<string, boolean | null> | undefined);
  }
  await db.attempt.createMany({ data: attempts });
  return { attempts: attempts.length };
}

function attemptRow(
  lessonId: string,
  seat: { id: string; studentId: string },
  kind: "OP112" | "DDS",
  incidentId: string,
  incidentServiceId: string | null,
  scenarioId: string,
  criteria: CriterionResult[],
  createdAt: Date,
  ctx: Ctx,
): Prisma.AttemptCreateManyInput {
  return {
    lessonId,
    seatId: seat.id,
    studentId: seat.studentId,
    kind,
    incidentId,
    incidentServiceId,
    scenarioId,
    criteria: criteria as unknown as Prisma.InputJsonValue,
    aiDraft: ruleDraft(criteria) as unknown as Prisma.InputJsonValue,
    score: computeScore(criteria, ctx.weights),
    reviewStatus: "PENDING",
    createdAt,
  };
}

/** Other services on the card are played by the system: they answer in time. */
function botEvents(serviceId: number, addedAt: Date, plateId: string) {
  const svc = SERVICES.find((s) => s.id === serviceId);
  if (!svc || svc.delivery === "PHONE") return { events: [] as Prisma.StatusEventCreateManyInput[], last: null };
  const actor = svc.delivery === "VIS" ? "оп. 9999" : "оп. 0";
  const chain: [ServiceStatus, number, string][] = [
    ["RECEIVED", between(2, 6), ""],
    ["ACCEPTED", between(10, 25), "Принято в работу"],
    ["STARTED", between(90, 160), "Выезд"],
  ];
  return {
    events: chain.map(([status, sec, comment]) => ({ incidentServiceId: plateId, status, comment: comment || undefined, actorLabel: actor, at: at(addedAt, sec) })),
    last: "STARTED" as ServiceStatus,
  };
}

// ─── running lesson with timers relative to now ─────────────────────────────
async function buildLive(ctx: Ctx, groupId: string) {
  const start = new Date(Date.now() - 7 * 60_000);
  const students = await db.user.findMany({ where: { login: { in: ["student1", "student2", "student3", "student4", "student5"] } }, orderBy: { login: "asc" } });
  await db.lesson.create({
    data: {
      id: "demo-lesson-live",
      title: "Живое занятие (демо)",
      teacherId: ctx.teacherId,
      groupId,
      status: "RUNNING",
      startedAt: start,
      settings: { ...liveSettings(ctx) } as Prisma.InputJsonValue,
    },
  });
  const roles: ("OP112" | "DDS")[] = ["OP112", "DDS", "DDS", "DDS", "OP112"];
  const seats = [];
  for (const [i, s] of students.entries()) {
    seats.push(
      await db.seat.create({
        data: {
          lessonId: "demo-lesson-live",
          studentId: s.id,
          role: roles[i],
          serviceId: roles[i] === "DDS" ? VORONOVSKOE : null,
          scenarioIds: [SCENARIOS[i % 5].id],
          label: `Место ${i + 1}`,
        },
      }),
    );
  }
  const now = Date.now();
  const ago = (sec: number) => new Date(now - sec * 1000);
  // Place 1 (112): typing a card for 48 s, call in progress.
  const fx0 = SCENARIOS[0];
  const draft = await db.incident.create({
    data: { lessonId: "demo-lesson-live", scenarioId: fx0.id, source: "op112", createdBySeatId: seats[0].id, status: "draft", openedAt: ago(48), createdAt: ago(48) },
  });
  await db.call.create({
    data: {
      lessonId: "demo-lesson-live",
      seatId: seats[0].id,
      incidentId: draft.id,
      kind: "CALLER_IN",
      status: "ACTIVE",
      counterpart: { name: "Соколова Вера Ивановна", role: "заявитель", voice: "female" },
      messages: dialogue(fx0, ago(48)).slice(0, 5),
      startedAt: ago(52),
      answeredAt: ago(48),
    },
  });
  // Places 2–4 (ДДС): one on time, one late with the answer, one with a refusal without addressee.
  const liveDds: { seat: (typeof seats)[number]; fx: Fixture; addedAgo: number; events: Event[] }[] = [
    { seat: seats[1], fx: SCENARIOS[1], addedAgo: 95, events: [{ status: "RECEIVED", sec: 4 }, { status: "ACCEPTED", sec: 17, comment: "Направлена бригада, наряд 23", crew: "23" }] },
    { seat: seats[2], fx: SCENARIOS[2], addedAgo: 44, events: [{ status: "RECEIVED", sec: 6 }] },
    { seat: seats[3], fx: SCENARIOS[3], addedAgo: 130, events: [{ status: "RECEIVED", sec: 5 }, { status: "REJECTED", sec: 26, comment: HANDOVER_BAD }] },
  ];
  for (const item of liveDds) {
    const t0 = ago(item.addedAgo);
    const incident = await db.incident.create({
      data: {
        lessonId: "demo-lesson-live",
        scenarioId: item.fx.id,
        source: "generated",
        status: "registered",
        address: { descriptive: item.fx.address },
        description: item.fx.description,
        savedAt: t0,
        createdAt: t0,
      },
    });
    const plate = await db.incidentService.create({ data: { incidentId: incident.id, serviceId: VORONOVSKOE, addedBy: "auto", addedAt: t0 } });
    const student = students.find((s) => s.id === item.seat.studentId)!;
    await db.statusEvent.createMany({
      data: [
        { incidentServiceId: plate.id, status: "ADDED", actorLabel: "система", seatId: item.seat.id, at: t0 },
        ...item.events.map((e) => ({
          incidentServiceId: plate.id,
          status: e.status,
          comment: e.comment,
          crewNumber: e.crew,
          actorLabel: student.fullName,
          actorUserId: student.id,
          seatId: item.seat.id,
          late: false,
          at: at(t0, e.sec),
        })),
      ],
    });
    const last = item.events[item.events.length - 1];
    await db.incidentService.update({ where: { id: plate.id }, data: { status: last.status } });
  }
  // A second card waits in the queue of place 2.
  const q = await db.incident.create({
    data: { lessonId: "demo-lesson-live", scenarioId: SCENARIOS[4].id, source: "generated", status: "registered", address: { descriptive: SCENARIOS[4].address }, description: SCENARIOS[4].description, savedAt: ago(12), createdAt: ago(12) },
  });
  const qPlate = await db.incidentService.create({ data: { incidentId: q.id, serviceId: VORONOVSKOE, addedBy: "auto", addedAt: ago(12) } });
  await db.statusEvent.create({ data: { incidentServiceId: qPlate.id, status: "ADDED", actorLabel: "система", seatId: seats[1].id, at: ago(12) } });
  await db.attempt.create({
    data: {
      lessonId: "demo-lesson-live",
      seatId: seats[4].id,
      studentId: seats[4].studentId,
      kind: "OP112",
      scenarioId: SCENARIOS[1].id,
      criteria: simulate112(SCENARIOS[1], PROFILES.student5, ctx).crits as unknown as Prisma.InputJsonValue,
      reviewStatus: "PENDING",
      createdAt: ago(200),
    },
  });
}

function liveSettings(ctx: Ctx) {
  return { categories: [], cardSource: "mixed", tempoSec: 90, maxQueue: 3, ackSec: ctx.ackSec, workSec: ctx.workSec, typingSec: ctx.typingSec, hints: false, brigadeReports: true, sameCard: false };
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  const live = process.argv.includes("--live");
  const teacher = await db.user.findUnique({ where: { login: "teacher" } });
  const group = await db.group.findFirst({ where: { name: "Учебная группа № 1" } });
  if (!teacher || !group) throw new Error("Сначала выполните основной seed: pnpm db:seed");

  for (const s of SERVICES) {
    await db.service.upsert({
      where: { id: s.id },
      update: {},
      create: { id: s.id, shortName: s.shortName, fullName: s.fullName, kind: s.kind, delivery: s.delivery, okrug: s.okrug, district: s.district, orderIdx: s.id },
    });
  }
  for (const s of SCENARIOS) {
    await db.scenario.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        title: s.title,
        category: s.category,
        difficulty: s.difficulty,
        status: s.status,
        source: "teacher",
        caller: s.caller,
        truth: s.truth,
        ddsCard: s.ddsCard,
        ddsReference: s.ddsReference,
        approvedSections: s.approvedSections,
        createdById: teacher.id,
        approvedById: s.status === "APPROVED" ? teacher.id : null,
      },
    });
  }

  const profile = await db.weightProfile.findFirst({ where: { isActive: true } });
  const weights = (profile?.weights ?? { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 }) as Weights;
  const ctx: Ctx = { weights, teacherId: teacher.id, ackSec: 30, workSec: 180, typingSec: 65 };

  await db.lesson.deleteMany({ where: { id: { in: ["demo-lesson-1", "demo-lesson-2", "demo-lesson-3", "demo-lesson-live"] } } });

  const base = { categories: [], tempoSec: 90, maxQueue: 3, ackSec: 30, workSec: 180, typingSec: 65, hints: false, brigadeReports: true };
  const l1 = await buildLesson({
    id: "demo-lesson-1",
    title: "ЖКХ и газ: первые карточки",
    status: "FINISHED",
    start: new Date("2026-09-23T07:00:00Z"),
    durationMin: 45,
    groupId: group.id,
    settings: { ...base, cardSource: "generated", hints: true, sameCard: false },
    plan: [
      { login: "student1", role: "OP112", tasks: ["demo-gas-lms", "demo-lift-child"] },
      { login: "student2", role: "DDS", tasks: ["demo-flood-heating", "demo-gas-lms", "demo-lift-child"] },
      { login: "student3", role: "DDS", tasks: ["demo-flood-heating", "demo-fire-container", "demo-gas-lms"] },
      { login: "student4", role: "DDS", tasks: ["demo-fire-container", "demo-lift-child", "demo-flood-heating"] },
      { login: "student5", role: "OP112", tasks: ["demo-flood-heating", "demo-fire-container"] },
    ],
    review: (i) => (i % 7 === 3 ? "OVERRIDDEN" : "CONFIRMED"),
    ctx,
  });
  const l2 = await buildLesson({
    id: "demo-lesson-2",
    title: "Смешанный поток: 112 → ДДС",
    status: "FINISHED",
    start: new Date("2026-09-25T07:00:00Z"),
    durationMin: 40,
    groupId: group.id,
    settings: { ...base, cardSource: "mixed", sameCard: false },
    plan: [
      { login: "student1", role: "DDS", tasks: ["demo-dtp-victims", "demo-fire-container"] },
      { login: "student2", role: "OP112", tasks: ["demo-dtp-victims", "demo-gas-lms"] },
      { login: "student3", role: "OP112", tasks: ["demo-flood-heating", "demo-dtp-victims"] },
      { login: "student4", role: "DDS", tasks: ["demo-gas-lms", "demo-dtp-victims"] },
      { login: "student5", role: "DDS", tasks: ["demo-lift-child", "demo-fire-container", "demo-dtp-victims"] },
    ],
    review: (i, total) => (i < Math.floor(total * 0.4) ? (i === 2 ? "OVERRIDDEN" : "CONFIRMED") : "PENDING"),
    ctx,
  });
  await buildLesson({
    id: "demo-lesson-3",
    title: "Итоговое: одна карточка на всех",
    status: "DRAFT",
    start: new Date(),
    durationMin: 45,
    groupId: group.id,
    settings: { ...base, cardSource: "generated", sameCard: true },
    plan: ["student1", "student2", "student3", "student4", "student5"].map((login) => ({ login, role: "DDS" as const, tasks: ["demo-dtp-victims"] })),
    review: () => "PENDING",
    ctx,
  });
  if (live) await buildLive(ctx, group.id);

  console.log(`seed-demo: lesson 1 — ${l1.attempts} attempts, lesson 2 — ${l2.attempts} attempts, draft lesson 3${live ? ", live lesson" : ""}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
