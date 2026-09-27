/**
 * Tasks written from the operator's instruction, not from the customer's tickets: the tickets always have a
 * caller who talks, so nothing in them ever needs «нет контакта» or «срыв звонка».
 *
 * The instruction («Инструкция по заведению карточки», раздел «Телефоны заявителя»): «Для быстрой обработки
 * нерезультативных вызовов предусмотрены кнопки: «Нет контакта» при отсутствии контакта с заявителем, «Срыв
 * звонка», если звонок сорвался». Such a card is closed at once («Завершена», «Проверено»), without services.
 * A call that breaks off after the caller has named what happened and where is not «нерезультативный»: the
 * card is filled from what was said and goes to the services (НВ-3).
 *
 * The line itself is played by rules (src/lib/op112/caller.ts, lineTurn), so the tasks behave the same with
 * and without a language model. scripts/build-scenarios.ts turns them into approved scenarios for the 112 place.
 */
import type { CallerPersona } from "../src/lib/incident/types";
import type { RoutingFlags } from "../src/lib/routing/engine";
import type { TicketAddress } from "./tickets";

export type LineTask = {
  ref: string;
  title: string;
  category: string;
  difficulty: number;
  caller: CallerPersona;
  /** The right answer is an empty card closed with this button. */
  emptyCall?: "noContact" | "dropped";
  /** A call with something to act on: its reference card, as for a ticket. */
  types?: string[];
  alt?: string[];
  flags?: RoutingFlags;
  addr?: TicketAddress;
  questions: string[];
  keywords?: string[];
  traps: string[];
};

export const LINE_CATEGORY = "тишина и срыв звонка";

const BUTTONS_FADE = "Кнопки «нет контакта» и «срыв звонка» работают, пока не выбран тип происшествия";

export const LINE_TASKS: LineTask[] = [
  {
    ref: "НВ-1",
    title: "НВ-1. Тишина на линии",
    category: LINE_CATEGORY,
    difficulty: 4,
    caller: {
      fullName: "Абонент не ответил",
      role: "не установлен",
      phone: "+7 (926) 404-17-58",
      visibleAddress: "адрес не назван",
      situation: "Вызов принят, но в трубке тишина: абонент не отвечает, слышен только шум.",
      facts: ["На вызов никто не отвечает, в трубке только шум"],
      temper: "calm",
      voice: "male",
      line: "silent",
      dropAfter: 4,
    },
    emptyCall: "noContact",
    questions: [],
    traps: ["Карточка со службами по пустому вызову отправит службы на вызов, которого не было", BUTTONS_FADE],
  },
  {
    ref: "НВ-2",
    title: "НВ-2. Звонок сорвался на первой фразе",
    category: LINE_CATEGORY,
    difficulty: 4,
    caller: {
      fullName: "Абонент не назвался",
      role: "не установлен",
      phone: "+7 (915) 262-81-09",
      visibleAddress: "адрес не успел назвать",
      situation: "Абонент начал говорить, но связь оборвалась на первой фразе.",
      facts: ["Связь оборвалась раньше, чем абонент сказал, что случилось и где"],
      temper: "panic",
      voice: "female",
      line: "drops",
      dropAfter: 1,
      opening: "Алло! Алло, это сто двенадцать? Тут у нас…",
      dropLine: "Вы меня слышите? Тут…",
    },
    emptyCall: "dropped",
    questions: [],
    traps: ["«Нет контакта» — для вызова, где заявителя не было слышно; здесь голос был, звонок сорвался", BUTTONS_FADE],
  },
  {
    ref: "НВ-3",
    title: "НВ-3. Горит машина во дворе, связь прервалась",
    category: LINE_CATEGORY,
    difficulty: 5,
    caller: {
      fullName: "Кравцова Ольга Николаевна",
      role: "очевидец",
      phone: "+7 (926) 518-44-07",
      visibleAddress: "улица Берзарина, дом 21, во дворе",
      situation: "Во дворе горит машина, из-под капота пламя. Людей рядом нет.",
      facts: [
        "Горит легковая машина во дворе, пламя из-под капота, чёрный дым",
        "Людей рядом нет, никто не пострадал",
        "Машина стоит у третьего подъезда, до дома метров пять",
      ],
      temper: "calm",
      voice: "female",
      line: "drops",
      dropAfter: 3,
      dropLine: "Я же сказала — Берзарина, двадцать од…",
    },
    types: ["пожар: машина"],
    alt: ["задымление: машина"],
    flags: {},
    addr: {
      city: "Москва",
      street: "улица Берзарина",
      house: "21",
      district: "Щукино",
      okrug: "СЗАО",
      descriptive: "во дворе, у третьего подъезда",
      confidence: "medium",
    },
    questions: ["Адрес происшествия"],
    keywords: ["гор|пожар|пламя|дым|огон", "машин|автомоб|а/м|авто"],
    traps: [
      "Связь прервалась, но суть и адрес уже известны: вызов результативный — завести карточку и оповестить службы, а не нажимать «срыв звонка»",
      "Имя заявителя может остаться неизвестным: не выдумывать его",
    ],
  },
];
