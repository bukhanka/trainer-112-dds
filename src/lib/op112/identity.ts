/**
 * One caller per situation in a lesson. The customer's tickets reuse their callers: «Иванова Елена Сергеевна» calls in
 * 25 tickets, «+7 (916) 896-32-54» in 49. In a lesson that would be one person phoning again and again, and the 112
 * place would show «Совпадение» by number with a card of a different incident. So a caller whose name or number is
 * already taken in the lesson by another situation gets a name and a number of its own — deterministically, from the
 * lesson and the situation, so the same lesson plays the same way. The first caller keeps the ticket's identity; the
 * same situation (a ticket and its variant «-ош», one task at two places) keeps one caller. A repeat call («ПВ»,
 * truth.repeatOf) is left as written: a second call from the same number is what it trains.
 */
import { genderOfName } from "./caller";
import { low } from "./facts";

/** A caller already in the lesson: of which situation, under what name and number. */
export type TakenCaller = { situation: string; fullName?: string | null; phone?: string | null };

type Person = { fullName: string; phone?: string; voice?: "male" | "female"; situation?: string; visibleAddress?: string; facts?: string[] };

const SURNAMES = [
  "Кузнецов", "Попов", "Васильев", "Новиков", "Волков", "Лебедев", "Козлов", "Егоров", "Павлов", "Семёнов", "Голубев", "Виноградов",
  "Богданов", "Воробьёв", "Фёдоров", "Михайлов", "Беляев", "Тарасов", "Белов", "Комаров", "Орлов", "Киселёв", "Макаров", "Андреев",
  "Ильин", "Гусев", "Кудрявцев", "Баранов", "Куликов", "Алексеев", "Яковлев", "Сорокин", "Романов", "Захаров", "Борисов", "Королёв",
  "Герасимов", "Пономарёв", "Григорьев", "Лазарев",
];
const MALE = [
  "Алексей", "Андрей", "Артём", "Борис", "Вадим", "Виктор", "Владимир", "Геннадий", "Григорий", "Денис", "Дмитрий", "Евгений", "Егор",
  "Игорь", "Кирилл", "Константин", "Леонид", "Максим", "Михаил", "Никита", "Николай", "Олег", "Павел", "Роман", "Руслан", "Семён",
  "Станислав", "Степан", "Тимур", "Юрий",
];
const FEMALE = [
  "Алина", "Анастасия", "Валентина", "Вера", "Виктория", "Галина", "Дарья", "Евгения", "Екатерина", "Елизавета", "Жанна", "Зоя", "Инна",
  "Карина", "Ксения", "Лариса", "Любовь", "Людмила", "Маргарита", "Марина", "Мария", "Надежда", "Наталья", "Нина", "Оксана", "Полина",
  "Светлана", "Тамара", "Татьяна", "Юлия",
];
const FATHERS = [
  "Александров", "Алексеев", "Андреев", "Борисов", "Васильев", "Викторов", "Владимиров", "Дмитриев", "Евгеньев", "Игорев", "Константинов",
  "Леонидов", "Михайлов", "Николаев", "Олегов", "Павлов", "Романов", "Сергеев", "Юрьев", "Геннадьев",
];
const CODES = ["903", "905", "909", "915", "916", "925", "926", "929", "977", "985", "999"];

/** FNV-1a: a small stable hash, the same in every run. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const phoneKey = (p?: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
/** Surname and given name, without a note in brackets: «Смирнова (мама)» → «смирнова». */
export const nameKey = (n?: string | null) =>
  low(n ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");

function phoneFrom(h: number, h2: number): string {
  const d = String(h % 10_000_000).padStart(7, "0");
  return `+7 (${CODES[h2 % CODES.length]}) ${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 7)}`;
}

/** A new name of the caller's sex; the surname stays when the ticket names a relative by it («Маркова» — «Марков Илья»). */
function nameFrom(p: Person, h: number): string {
  const note = /\s*\([^)]*\)\s*$/.exec(p.fullName)?.[0] ?? "";
  const [surname] = p.fullName.replace(/\s*\([^)]*\)\s*$/, "").trim().split(/\s+/);
  const female = (p.voice ?? (genderOfName(p.fullName) === "male" ? "male" : "female")) === "female";
  const texts = low([p.situation, p.visibleAddress, ...(p.facts ?? [])].join(" "));
  const stem = low(surname ?? "").replace(/(ова|ева|ёва|ина|ая)$/, (m) => m.slice(0, -1));
  const family = stem.length >= 4 && texts.includes(stem);
  const base = SURNAMES[h % SURNAMES.length];
  const last = family ? surname : female ? `${base}а` : base;
  const given = (female ? FEMALE : MALE)[(h >>> 7) % 30];
  const father = FATHERS[(h >>> 13) % FATHERS.length];
  return `${last} ${given} ${father.replace(/ев$/, "е").replace(/ов$/, "о")}${female ? "вна" : "вич"}${note}`;
}

/**
 * The caller of a situation in this lesson: the ticket's own name and number while nobody else in the lesson has them,
 * the one already given to this situation, or a new pair made from the lesson and the situation.
 */
export function distinctCaller<P extends Person>(persona: P, situation: string, lessonId: string, taken: TakenCaller[]): P {
  const mine = taken.find((t) => t.situation === situation && (t.fullName || t.phone));
  if (mine) return { ...persona, ...(mine.fullName ? { fullName: mine.fullName } : {}), ...(mine.phone ? { phone: mine.phone } : {}) };
  const others = taken.filter((t) => t.situation !== situation);
  const phones = new Set(others.map((t) => phoneKey(t.phone)).filter(Boolean));
  const names = new Set(others.map((t) => nameKey(t.fullName)).filter(Boolean));
  const out: P = { ...persona };
  if (persona.phone && phones.has(phoneKey(persona.phone))) {
    for (let k = 0; k < 50; k++) {
      const phone = phoneFrom(hash(`${lessonId}:${situation}:phone:${k}`), hash(`${situation}:${lessonId}:${k}`));
      if (!phones.has(phoneKey(phone))) {
        out.phone = phone;
        break;
      }
    }
  }
  if (nameKey(persona.fullName) && names.has(nameKey(persona.fullName))) {
    for (let k = 0; k < 50; k++) {
      const fullName = nameFrom(persona, hash(`${lessonId}:${situation}:name:${k}`));
      if (!names.has(nameKey(fullName))) {
        out.fullName = fullName;
        break;
      }
    }
  }
  return out;
}
