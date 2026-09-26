/**
 * Extra approved scenarios for the ДДС place of «Поселение Вороновское», written in the format of
 * data/scenarios.json: the memo's typical mistakes (a refusal without «кому передано», a job closed as
 * «Работы завершены» that should be «Отказ», progress statuses skipped) on cards of this settlement.
 *
 *   pnpm exec tsx prisma/dev-fixtures-dds.ts      (after pnpm db:seed — services come from the reference import)
 *
 * Ids start with «dev-dds-»; no ticketRef, so the tickets import never matches them. Rewritten on every run.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const db = new PrismaClient();

const VORONOVO = { country: "Россия", subject: "Москва", city: "Москва", okrug: "ТиНАО", district: "Вороновское" };
const plate = (serviceId: number, shortName: string, isMain = false) => ({ serviceId, shortName, isMain });
const NO_FLAGS = { victims: false, refusedAmbulance: false, blocked: false };

type Fixture = {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  caller: Prisma.InputJsonValue;
  truth: Prisma.InputJsonValue;
  ddsCard: Prisma.InputJsonValue;
  ddsReference: Prisma.InputJsonValue;
};

const PREFECTURE = {
  serviceId: 181,
  service: "Поселение ТиНАО",
  decision: "ACCEPTED",
  chain: ["ACCEPTED", "FINISHED"],
  brigadeReport: "—",
  commentMustHave: ["принято к сведению", "чем закончилось"],
  traps: [],
};

const SCENARIOS: Fixture[] = [
  {
    id: "dev-dds-fire-flat",
    title: "Пожар в квартире (пос. ЛМС, Вороновское)",
    category: "пожар",
    difficulty: 5,
    caller: {
      fullName: "Кравцова Анна Сергеевна",
      role: "очевидец",
      phone: "+7 (916) 126-34-71",
      visibleAddress: "посёлок ЛМС, микрорайон Солнечный, дом 5",
      hiddenAddress: "второй подъезд, квартира 12, третий этаж",
      situation: "Из окна квартиры на третьем этаже идёт чёрный дым, в подъезде пахнет гарью",
      facts: [
        "Горит квартира 12 на третьем этаже, дверь закрыта",
        "Соседи с третьего по пятый этаж выходят на улицу сами",
        "Пострадавших не видела",
        "Дом пятиэтажный, газифицирован",
        "Пожарные уже подъезжают, слышно сирену",
      ],
      temper: "panic",
      voice: "female",
    },
    truth: {
      kind: "101",
      typeCodes: [1050101],
      finalType: "пожар: квартира",
      tags: ["дом", "открытое пламя", "квартира", "угроза людям", "газификация"],
      flags: { threat: true, gas: true },
      address: { ...VORONOVO, street: "пос. ЛМС, мкр Солнечный", house: "5", entrance: "2", floor: "3", flat: "12" },
      addressLine: "Москва, пос. ЛМС, мкр Солнечный, д. 5, кв. 12",
      services: [
        plate(1, "Служба 101", true),
        plate(5, "Служба 104"),
        plate(113, "Служба 102"),
        plate(14, "Деп. ЖКХ"),
        plate(3, "ЦЭМП"),
        plate(7, "ЦОДД"),
        plate(17, "Мос.Без."),
        plate(21, "Мослифт"),
        plate(33, "ОАТИ"),
        plate(181, "Поселение ТиНАО"),
        plate(191, "Поселение Вороновское"),
      ],
    },
    ddsCard: {
      classLabel: "пожар: квартира",
      tagsLine: "Дом · Открытое пламя / Дым (дом), Запах гари (дом) · Дом многоквартирный · квартира · Есть угроза людям · Есть газификация",
      flags: NO_FLAGS,
      address: "Москва, пос. ЛМС, мкр Солнечный, д. 5, кв. 12",
      descriptive: "Троицкий административный округ",
      description: "Пожар в квартире на 3-м этаже, из окна идёт дым, жильцы выходят сами",
      caller: { fullName: "Кравцова Анна Сергеевна", status: "очевидец", aon: "+7 (916) 126-34-71", provided: "+7 (916) 126-34-71" },
      services: ["Служба 101", "Служба 104", "Служба 102", "Деп. ЖКХ", "ЦЭМП", "ЦОДД", "Мос.Без.", "Мослифт", "ОАТИ", "Поселение ТиНАО", "Поселение Вороновское"],
    },
    ddsReference: {
      rules: [],
      services: [
        {
          serviceId: 191,
          service: "Поселение Вороновское",
          decision: "ACCEPTED",
          chain: ["ACCEPTED", "STARTED", "ARRIVED", "WORKING", "FINISHED"],
          brigadeReport: "Вода по стояку перекрыта, газ отключён Службой 104, жильцы второго подъезда выведены, возгорание потушено Службой 101",
          commentMustHave: ["перекрыта вода по стояку", "жильцы эвакуированы", "кто потушил (Служба 101)"],
          traps: ["Не ставить «Не принята» только потому, что тушит Служба 101: коммунальная часть — работа ДДС поселения"],
          crew: { work: "перекрываем воду по стояку и помогаем пожарным выводить жильцов" },
        },
        PREFECTURE,
      ],
    },
  },
  {
    id: "dev-dds-lift",
    title: "Застревание в лифте: лифты обслуживает подрядчик (пос. Вороново)",
    category: "городское хозяйство",
    difficulty: 4,
    caller: {
      fullName: "Белов Олег Юрьевич",
      role: "очевидец",
      phone: "+7 (903) 226-13-83",
      visibleAddress: "посёлок Вороново, дом 3",
      hiddenAddress: "первый подъезд, лифт между пятым и шестым этажами",
      situation: "Застряли в лифте вдвоём между пятым и шестым этажами",
      facts: ["Нас двое взрослых, самочувствие нормальное", "Медицинская помощь не нужна", "Кнопка связи с диспетчером в лифте не отвечает", "Первый подъезд"],
      temper: "angry",
      voice: "male",
    },
    truth: {
      kind: "Лифт",
      finalType: "застревание в лифте",
      tags: ["дом", "лифт", "застревание"],
      flags: {},
      address: { ...VORONOVO, street: "пос. Вороново", house: "3", entrance: "1" },
      addressLine: "Москва, пос. Вороново, д. 3",
      services: [plate(21, "Мослифт", true), plate(191, "Поселение Вороновское"), plate(181, "Поселение ТиНАО")],
    },
    ddsCard: {
      classLabel: "застревание в лифте",
      tagsLine: "Дом · Лифт · Застревание людей · Мед. помощь не требуется · Дом многоквартирный",
      flags: NO_FLAGS,
      address: "Москва, пос. Вороново, д. 3, под. 1",
      descriptive: "лифт между 5 и 6 этажами",
      description: "Застряли в лифте двое взрослых между 5 и 6 этажами, самочувствие нормальное. Лифты дома обслуживает ООО «Практика»",
      caller: { fullName: "Белов Олег Юрьевич", status: "очевидец", aon: "+7 (903) 226-13-83", provided: "+7 (903) 226-13-83" },
      services: ["Мослифт", "Поселение Вороновское", "Поселение ТиНАО"],
    },
    ddsReference: {
      rules: [],
      services: [
        {
          serviceId: 191,
          service: "Поселение Вороновское",
          decision: "REJECTED",
          decisionComment: "Лифты дома не обслуживаем, информация передана в диспетчерскую ООО «Практика»",
          chain: ["REJECTED"],
          brigadeReport: "—",
          commentMustHave: ["причина: лифты обслуживает подрядчик", "кому передано (ООО «Практика»)"],
          traps: ["«Не принята: не обслуживаем» без указания, кому передано, — нарушение из памятки"],
          transferTo: ["Практик"],
          contacts: [{ name: "Диспетчерская ООО «Практика» (лифты)", phone: "+7 (495) 000-44-44" }],
        },
        PREFECTURE,
      ],
    },
  },
  {
    id: "dev-dds-pipe",
    title: "Прорыв трубы горячей воды, заливает подъезд (пос. ЛМС)",
    category: "городское хозяйство",
    difficulty: 5,
    caller: {
      fullName: "Селезнева Наталья Петровна",
      role: "очевидец",
      phone: "+7 (903) 226-13-84",
      visibleAddress: "посёлок ЛМС, микрорайон Солнечный, дом 12",
      hiddenAddress: "первый подъезд, пятый этаж",
      situation: "Прорвало трубу горячей воды на пятом этаже, кипяток течёт по лестнице",
      facts: ["Горячая вода течёт по лестнице с пятого этажа", "Пострадавших нет, но на лестнице пар", "Дом пятиэтажный", "До управляющей компании не дозвонилась"],
      temper: "panic",
      voice: "female",
    },
    truth: {
      kind: "Авария ЖКХ",
      finalType: "Прорыв трубы горячего водоснабжения",
      tags: ["дом", "подъезд", "прорыв трубы"],
      flags: { threat: true },
      address: { ...VORONOVO, street: "пос. ЛМС, мкр Солнечный", house: "12", entrance: "1", floor: "5" },
      addressLine: "Москва, пос. ЛМС, мкр Солнечный, д. 12",
      services: [plate(14, "Деп. ЖКХ", true), plate(191, "Поселение Вороновское"), plate(181, "Поселение ТиНАО")],
    },
    ddsCard: {
      classLabel: "Прорыв трубы горячего водоснабжения",
      tagsLine: "Дом · Подъезд · Прорыв трубы · Горячая вода · Дом многоквартирный",
      flags: NO_FLAGS,
      address: "Москва, пос. ЛМС, мкр Солнечный, д. 12, под. 1",
      descriptive: "лестничная клетка 5-го этажа",
      description: "Прорыв трубы ГВС на 5-м этаже, заливает подъезд горячей водой",
      caller: { fullName: "Селезнева Наталья Петровна", status: "очевидец", aon: "+7 (903) 226-13-84", provided: "+7 (903) 226-13-84" },
      services: ["Деп. ЖКХ", "Поселение Вороновское", "Поселение ТиНАО"],
    },
    ddsReference: {
      rules: [],
      services: [
        {
          serviceId: 191,
          service: "Поселение Вороновское",
          decision: "ACCEPTED",
          chain: ["ACCEPTED", "STARTED", "ARRIVED", "WORKING", "FINISHED"],
          brigadeReport: "Стояк ГВС перекрыт, участок трубы заменён, течь устранена, горячая вода подана, подъезд убран",
          commentMustHave: ["стояк перекрыт", "течь устранена", "вода подана"],
          traps: ["Памятка: при потоке повторных звонков важны статусы хода работ с комментариями"],
          crew: { work: "перекрыли стояк, откачиваем воду из подъезда" },
        },
        PREFECTURE,
      ],
    },
  },
  {
    id: "dev-dds-wire",
    title: "Оборван провод во дворе: провод «Ростелекома» (пос. ЛМС)",
    category: "городское хозяйство",
    difficulty: 6,
    caller: {
      fullName: "Орлов Павел Андреевич",
      role: "очевидец",
      phone: "+7 (916) 897-56-23",
      visibleAddress: "Вороновское, посёлок ЛМС, двор дома 15",
      situation: "Во дворе оборван провод, висит низко над дорожкой",
      facts: ["Провод тонкий, похож на телефонный", "Искр нет", "Висит примерно в двух метрах над тротуаром", "Никто не пострадал"],
      temper: "calm",
      voice: "male",
    },
    truth: {
      kind: "Провода",
      finalType: "Обрыв проводов во дворе",
      tags: ["улица", "двор", "провод"],
      flags: {},
      address: { ...VORONOVO, street: "пос. ЛМС", house: "15" },
      addressLine: "Москва, пос. ЛМС, д. 15, двор",
      services: [plate(191, "Поселение Вороновское", true), plate(181, "Поселение ТиНАО"), plate(14, "Деп. ЖКХ")],
    },
    ddsCard: {
      classLabel: "Обрыв проводов во дворе",
      tagsLine: "Улица · Двор · Оборван провод · Назначение неизвестно",
      flags: NO_FLAGS,
      address: "Москва, пос. ЛМС, д. 15, двор",
      descriptive: "двор, над тротуаром",
      description: "Во дворе оборван провод неизвестного назначения, висит над тротуаром",
      caller: { fullName: "Орлов Павел Андреевич", status: "очевидец", aon: "+7 (916) 897-56-23", provided: "+7 (916) 897-56-23" },
      services: ["Поселение Вороновское", "Поселение ТиНАО", "Деп. ЖКХ"],
    },
    ddsReference: {
      rules: [],
      services: [
        {
          serviceId: 191,
          service: "Поселение Вороновское",
          decision: "ACCEPTED",
          chain: ["ACCEPTED", "STARTED", "ARRIVED", "REFUSED"],
          brigadeReport: "—",
          commentMustHave: ["чей провод (Ростелеком)", "кому передано", "место огорожено"],
          traps: ["Памятка: «Работы завершены: провод не наш» — неверно, нужен «Отказ от выполнения работ» с причиной и кому передано"],
          transferTo: ["Ростелеком", "передан"],
          contacts: [{ name: "Дежурная служба «Ростелеком»", phone: "+7 (495) 000-55-55" }],
          crew: {
            work: "осматриваем провод",
            refuse: "провод слаботочный, принадлежит «Ростелекому», наших работ здесь нет — передайте им, место мы оградили лентой",
          },
        },
        PREFECTURE,
      ],
    },
  },
];

async function main() {
  const known = await db.service.count({ where: { id: { in: [1, 3, 5, 7, 14, 17, 21, 33, 113, 181, 191] } } });
  if (known < 11) throw new Error("Services are missing: run `pnpm db:seed` first (reference import).");
  const approvedSections = ["caller", "truth", "ddsCard", "ddsReference"];
  for (const s of SCENARIOS) {
    const data = { ...s, status: "APPROVED" as const, source: "teacher", approvedSections };
    await db.scenario.upsert({ where: { id: s.id }, update: data, create: data });
  }
  console.log(`dev fixtures: ${SCENARIOS.length} ДДС scenarios for «Поселение Вороновское»`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
