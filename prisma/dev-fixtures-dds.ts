/**
 * Development fixtures for the ДДС place: a few services and six approved scenarios, enough to run
 * the workstation before the full reference import lands.
 *
 *   pnpm exec tsx prisma/dev-fixtures-dds.ts
 *
 * Service ids follow the customer's list («СЛУЖБЫ 112», order number), and services are only created
 * when missing, so the full import may run before or after this script. Scenario ids start with
 * «dev-dds-» and are rewritten on every run.
 */
import { PrismaClient, type Prisma, type ServiceDelivery } from "@prisma/client";

const db = new PrismaClient();

type ServiceFixture = {
  id: number;
  shortName: string;
  fullName: string;
  kind: string;
  delivery: ServiceDelivery;
  phone: string;
  okrug?: string;
  district?: string;
};

const SERVICES: ServiceFixture[] = [
  { id: 1, shortName: "Служба 101", fullName: "ГУ МЧС России по г. Москве, ГКУ «Пожарно-спасательный центр» ОДС", kind: "центральная", delivery: "VIS", phone: "101" },
  { id: 3, shortName: "ЦЭМП", fullName: "Центр экстренной медицинской помощи", kind: "центральная", delivery: "ARM112", phone: "+7 (495) 000-03-03" },
  { id: 4, shortName: "Служба 103", fullName: "Станция скорой и неотложной медицинской помощи", kind: "центральная", delivery: "VIS", phone: "103" },
  { id: 5, shortName: "Служба 104", fullName: "АО «МОСГАЗ» Диспетчерское управление", kind: "центральная", delivery: "VIS", phone: "104" },
  { id: 7, shortName: "ЦОДД", fullName: "ГКУ «Центр организации дорожного движения»", kind: "ведомственная", delivery: "VIS", phone: "+7 (495) 000-07-07" },
  { id: 14, shortName: "Деп. ЖКХ", fullName: "Департамент ЖКХ", kind: "ведомственная", delivery: "PHONE", phone: "+7 (495) 000-14-14" },
  { id: 17, shortName: "Мос.Без.", fullName: "Московская Безопасность", kind: "ведомственная", delivery: "ARM112", phone: "+7 (495) 000-17-17" },
  { id: 21, shortName: "Мослифт", fullName: "Лифт МСК", kind: "ведомственная", delivery: "ARM112", phone: "+7 (495) 000-21-21" },
  { id: 33, shortName: "ОАТИ", fullName: "Объединение административно-технических инспекций", kind: "ведомственная", delivery: "ARM112", phone: "+7 (495) 000-33-33" },
  { id: 113, shortName: "Служба 102", fullName: "Дежурная часть ГУ МВД России по г. Москве", kind: "центральная", delivery: "VIS", phone: "102" },
  { id: 181, shortName: "Поселение ТиНАО", fullName: "ДДС префектуры Троицкого и Новомосковского округов", kind: "территориальная", delivery: "ARM112", phone: "+7 (495) 000-81-81", okrug: "ТиНАО", district: "ТиНАО" },
  { id: 191, shortName: "Поселение Вороновское", fullName: "ДДС поселения Вороновское в городе Москве", kind: "территориальная", delivery: "ARM112", phone: "+7 (495) 000-91-91", okrug: "ТиНАО", district: "Вороновское" },
];

const VORONOVO = { country: "Россия", city: "Москва", okrug: "ТАО", district: "Вороновское" };
const tag = (row: string, value: string) => ({ row, value });

type ScenarioFixture = {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  ticketRef?: string;
  caller: Prisma.InputJsonValue;
  truth: Prisma.InputJsonValue;
  ddsCard: Prisma.InputJsonValue;
  ddsReference: Prisma.InputJsonValue;
};

const SCENARIOS: ScenarioFixture[] = [
  {
    id: "dev-dds-fire-flat",
    title: "Пожар в квартире многоквартирного дома",
    category: "Пожар",
    difficulty: 4,
    caller: {
      fullName: "Кравцова Анна Сергеевна",
      role: "соседка, очевидец",
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
    truth: { typeCodes: [1050101], flags: { threat: true, gas: true }, services: [1, 5, 113, 14, 3, 7, 17, 21, 33, 181, 191] },
    ddsCard: {
      cardType: "101",
      finalTypes: ["пожар: квартира"],
      typeCodes: [1050101],
      tags: [
        tag("Место", "Дом"),
        tag("Признаки", "Открытое пламя / Дым (дом)"),
        tag("Признаки", "Запах гари (дом)"),
        tag("Объект", "Дом многоквартирный"),
        tag("Помещение", "квартира"),
        tag("Угроза", "Есть угроза людям"),
        tag("Газ", "Есть газификация"),
      ],
      address: { ...VORONOVO, street: "пос. ЛМС, мкр. Солнечный", house: "5", entrance: "2", floor: "3", flat: "12", descriptive: "Троицкий административный округ" },
      description: "Пожар в квартире на 3-м этаже, из окна идёт дым, жильцы выходят сами",
      flags: { threat: true, gas: true },
      services: [1, 5, 113, 14, 3, 7, 17, 21, 33, 181, 191],
    },
    ddsReference: {
      default: {
        decision: "accept",
        why: "Пожар в жилом доме поселения: ДДС поселения перекрывает воду и газ по стояку и помогает с эвакуацией жильцов",
        chain: ["STARTED", "ARRIVED", "WORKING", "FINISHED"],
        finalMust: ["перекры", "эваку", "отключ"],
        crew: {
          kind: "аварийная бригада (сантехники)",
          work: "перекрываем воду по стояку и помогаем пожарным выводить жильцов",
          result: "вода по стояку перекрыта, газ отключён Службой 104, жильцы второго подъезда выведены, возгорание потушено Службой 101",
        },
        traps: ["Не ставить «Не принята» только потому, что тушит Служба 101: коммунальная часть — работа ДДС поселения"],
      },
    },
  },
  {
    id: "dev-dds-gas-house",
    title: "Запах газа у трубы на вводе в частный дом",
    category: "Газ",
    difficulty: 3,
    ticketRef: "Б30-3",
    caller: {
      fullName: "Соколова Вера Ивановна",
      role: "хозяйка дома",
      phone: "+7 (916) 320-12-83",
      visibleAddress: "Вороновское, посёлок ЛМС, микрорайон Солнечный, дом 20",
      situation: "Во дворе частного дома пахнет газом от трубы на вводе в дом, в трубе слышен шум",
      facts: [
        "Газ магистральный, не баллонный",
        "Пахнет у трубы на вводе в дом, в самом доме не пахнет",
        "В доме двое взрослых, оба вышли на улицу",
        "Скорая не нужна, никому не плохо",
        "Краны не трогала",
      ],
      temper: "calm",
      voice: "female",
    },
    truth: { typeCodes: [13010700], flags: { gas: true }, services: [5, 1, 181, 191] },
    ddsCard: {
      cardType: "104",
      finalTypes: ["Запах бытового газа (прочее, вне помещения)"],
      typeCodes: [13010700],
      tags: [tag("Место", "Дом частный"), tag("Признаки", "Запах газа на улице"), tag("Признаки", "Шум в трубе"), tag("Газ", "Газ магистральный")],
      address: { ...VORONOVO, street: "пос. ЛМС, мкр. Солнечный", house: "20", descriptive: "частный дом, труба на вводе" },
      description: "Запах газа от трубы на вводе в частный дом, слышен шум в трубе. Газ магистральный, 03 не требуется",
      flags: { gas: true },
      services: [5, 1, 181, 191],
    },
    ddsReference: {
      default: {
        decision: "accept",
        why: "Угроза на газопроводе в поселении: ДДС ограждает место и держит связь со Службой 104",
        chain: ["STARTED", "ARRIVED", "FINISHED"],
        finalMust: ["104", "газ"],
        crew: {
          kind: "дежурный инженер поселения",
          work: "ограждаем участок и ждём аварийную бригаду 104",
          result: "аварийная бригада 104 устранила утечку на вводе, газ подан, жильцы вернулись в дом",
        },
      },
    },
  },
  {
    id: "dev-dds-lift",
    title: "Застревание в лифте: лифты дома обслуживает подрядчик",
    category: "Лифты",
    difficulty: 3,
    caller: {
      fullName: "Белов Олег Юрьевич",
      role: "житель дома",
      phone: "+7 (903) 226-13-83",
      visibleAddress: "посёлок Вороново, дом 3",
      hiddenAddress: "первый подъезд, лифт между пятым и шестым этажами",
      situation: "Застряли в лифте вдвоём между пятым и шестым этажами",
      facts: [
        "Нас двое взрослых, самочувствие нормальное",
        "Медицинская помощь не нужна",
        "Кнопка связи с диспетчером в лифте не отвечает",
        "Первый подъезд",
      ],
      temper: "angry",
      voice: "male",
    },
    truth: { flags: {}, services: [21, 191, 181] },
    ddsCard: {
      cardType: "Лифт",
      finalTypes: ["застревание в лифте"],
      tags: [tag("Место", "Дом"), tag("Объект", "Лифт"), tag("Признаки", "Застревание людей"), tag("Помощь", "Мед. помощь не требуется"), tag("Объект", "Дом многоквартирный")],
      address: { ...VORONOVO, street: "пос. Вороново", house: "3", entrance: "1", descriptive: "лифт между 5 и 6 этажами" },
      description: "Застряли в лифте двое взрослых между 5 и 6 этажами, самочувствие нормальное. Лифты дома обслуживает ООО «Практика»",
      flags: {},
      services: [21, 191, 181],
    },
    ddsReference: {
      default: {
        decision: "reject",
        why: "Лифты этого дома обслуживает ООО «Практика», а не ДДС поселения: реагировать не нужно, но информацию надо передать и указать это в комментарии",
        transferTo: ["Практик", "передан", "сообщен"],
        contacts: [{ name: "Диспетчерская ООО «Практика» (лифты)", phone: "+7 (495) 000-44-44" }],
        traps: ["«Не принята: не обслуживаем» без указания, кому передано, — нарушение из памятки"],
      },
    },
  },
  {
    id: "dev-dds-basement",
    title: "Посторонние в подвале жилого дома",
    category: "Охрана порядка",
    difficulty: 4,
    ticketRef: "Б28-1",
    caller: {
      fullName: "Иванова Инна Васильевна",
      role: "старшая по подъезду",
      phone: "+7 (916) 896-32-54",
      visibleAddress: "Вороновское, посёлок ЛМС, дом 8",
      hiddenAddress: "третий подъезд, вход в подвал со двора",
      situation: "В подвале дома посторонние люди, дверь в подвал открыта, слышны голоса",
      facts: ["Двое или трое мужчин, кто такие — не знаю", "Замок на двери подвала сорван", "Никто не пострадал", "Жильцы боятся спускаться"],
      temper: "calm",
      voice: "female",
    },
    truth: { flags: { offense: true }, services: [113, 191, 181] },
    ddsCard: {
      cardType: "102",
      finalTypes: ["Посторонние граждане в подвале"],
      tags: [tag("Место", "Дом"), tag("Помещение", "Подвал"), tag("Признаки", "Подозрительные / посторонние граждане"), tag("Объект", "Дом многоквартирный")],
      address: { ...VORONOVO, street: "пос. ЛМС", house: "8", entrance: "3", descriptive: "вход в подвал со двора" },
      description: "В подвале жилого дома посторонние, замок на двери подвала сорван",
      flags: { offense: true },
      services: [113, 191, 181],
    },
    ddsReference: {
      default: {
        decision: "accept",
        why: "Подвал жилого дома — зона ответственности коммунальных служб поселения: осмотреть и закрыть. «Не принята: в компетенции 102» — ошибка из памятки",
        chain: ["STARTED", "ARRIVED", "FINISHED"],
        finalMust: ["подвал", "замок", "закрыт"],
        crew: {
          kind: "дежурный техник",
          work: "вместе с участковым осматриваем подвал",
          result: "подвал осмотрен вместе с участковым, посторонних нет, замок заменён, подвал закрыт",
        },
        traps: ["«Не принята: в компетенции 102» — отказ от профильного происшествия"],
      },
    },
  },
  {
    id: "dev-dds-pipe",
    title: "Прорыв трубы горячей воды, заливает подъезд",
    category: "ЖКХ",
    difficulty: 4,
    caller: {
      fullName: "Селезнева Наталья Петровна",
      role: "жительница дома",
      phone: "+7 (903) 226-13-84",
      visibleAddress: "посёлок ЛМС, микрорайон Солнечный, дом 12",
      hiddenAddress: "первый подъезд, пятый этаж",
      situation: "Прорвало трубу горячей воды на пятом этаже, кипяток течёт по лестнице",
      facts: [
        "Горячая вода течёт по лестнице с пятого этажа",
        "Пострадавших нет, но на лестнице пар",
        "Дом пятиэтажный",
        "До управляющей компании не дозвонилась",
      ],
      temper: "panic",
      voice: "female",
    },
    truth: { flags: { threat: true }, services: [14, 191, 181] },
    ddsCard: {
      cardType: "Авария ЖКХ",
      finalTypes: ["Прорыв трубы горячего водоснабжения"],
      tags: [tag("Место", "Дом"), tag("Помещение", "Подъезд"), tag("Признаки", "Прорыв трубы"), tag("Признаки", "Горячая вода"), tag("Объект", "Дом многоквартирный")],
      address: { ...VORONOVO, street: "пос. ЛМС, мкр. Солнечный", house: "12", entrance: "1", floor: "5", descriptive: "лестничная клетка 5-го этажа" },
      description: "Прорыв трубы ГВС на 5-м этаже, заливает подъезд горячей водой",
      flags: { threat: true },
      services: [14, 191, 181],
    },
    ddsReference: {
      default: {
        decision: "accept",
        why: "Коммунальная авария в доме поселения. По памятке важны статусы хода работ с комментариями: жильцы будут звонить повторно",
        chain: ["STARTED", "ARRIVED", "WORKING", "FINISHED"],
        finalMust: ["стояк", "устран", "подан"],
        crew: {
          kind: "аварийная бригада",
          work: "перекрыли стояк, откачиваем воду из подъезда",
          result: "стояк ГВС перекрыт, участок трубы заменён, течь устранена, горячая вода подана, подъезд убран",
        },
      },
    },
  },
  {
    id: "dev-dds-wire",
    title: "Оборван провод во дворе жилого дома",
    category: "ЖКХ",
    difficulty: 5,
    caller: {
      fullName: "Орлов Павел Андреевич",
      role: "прохожий",
      phone: "+7 (916) 897-56-23",
      visibleAddress: "Вороновское, посёлок ЛМС, двор дома 15",
      situation: "Во дворе оборван провод, висит низко над дорожкой",
      facts: ["Провод тонкий, похож на телефонный", "Искр нет", "Висит примерно в двух метрах над тротуаром", "Никто не пострадал"],
      temper: "calm",
      voice: "male",
    },
    truth: { flags: {}, services: [191, 181, 14] },
    ddsCard: {
      cardType: "Провода",
      finalTypes: ["Обрыв проводов во дворе"],
      tags: [tag("Место", "Улица"), tag("Объект", "Двор"), tag("Признаки", "Оборван провод"), tag("Признаки", "Назначение неизвестно")],
      address: { ...VORONOVO, street: "пос. ЛМС", house: "15", descriptive: "двор, над тротуаром" },
      description: "Во дворе оборван провод неизвестного назначения, висит над тротуаром",
      flags: {},
      services: [191, 181, 14],
    },
    ddsReference: {
      default: {
        decision: "accept",
        why: "Сначала ДДС выясняет, чей провод. Провод слаботочный и принадлежит «Ростелекому»: правильное закрытие — «Отказ от выполнения работ» с комментарием, кому передано",
        chain: ["STARTED", "ARRIVED", "REFUSED"],
        transferTo: ["Ростелеком", "передан"],
        finalMust: ["Ростелеком"],
        contacts: [{ name: "Дежурная служба «Ростелеком»", phone: "+7 (495) 000-55-55" }],
        crew: {
          kind: "электрик",
          work: "осматриваем провод",
          refuse: "провод слаботочный, принадлежит «Ростелекому», наших работ здесь нет — передайте им, место мы оградили лентой",
        },
      },
    },
  },
];

async function main() {
  for (const s of SERVICES) {
    await db.service.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        shortName: s.shortName,
        fullName: s.fullName,
        kind: s.kind,
        delivery: s.delivery,
        phone: s.phone,
        okrug: s.okrug,
        district: s.district,
        orderIdx: s.id,
      },
    });
  }
  const approvedSections = ["caller", "truth", "ddsCard", "ddsReference"];
  for (const s of SCENARIOS) {
    const data = { ...s, status: "APPROVED" as const, source: s.ticketRef ? "ticket" : "teacher", approvedSections };
    await db.scenario.upsert({ where: { id: s.id }, update: data, create: data });
  }
  console.log(`dev fixtures: ${SERVICES.length} services, ${SCENARIOS.length} scenarios`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
