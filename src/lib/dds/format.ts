/**
 * Display helpers of the ДДС workstation: dates the way the customer's system prints them,
 * address lines, tags and «Класс.» rows. Pure, used on the server and in the browser.
 * Times are shown in Moscow time on every screen, whatever the viewer's time zone.
 */
import type { IncidentAddress, TagChoice } from "@/lib/incident/types";

export const APP_TZ = "Europe/Moscow";

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const partsFormat = new Intl.DateTimeFormat("ru-RU", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "long",
  hourCycle: "h23",
});

export type DateParts = { dd: string; mm: string; yyyy: string; yy: string; HH: string; MM: string; SS: string; weekday: string };

export function dateParts(input: Date | string | number): DateParts {
  const d = input instanceof Date ? input : new Date(input);
  const p: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(d)) p[part.type] = part.value;
  return {
    dd: p.day,
    mm: p.month,
    yyyy: p.year,
    yy: p.year.slice(-2),
    HH: p.hour,
    MM: p.minute,
    SS: p.second,
    weekday: p.weekday.charAt(0).toUpperCase() + p.weekday.slice(1),
  };
}

/** «17.09.2026 11:13:19» */
export function fmtDateTime(d: Date | string | number): string {
  const p = dateParts(d);
  return `${p.dd}.${p.mm}.${p.yyyy} ${p.HH}:${p.MM}:${p.SS}`;
}

/** «17.09.26» */
export function fmtDateShort(d: Date | string | number): string {
  const p = dateParts(d);
  return `${p.dd}.${p.mm}.${p.yy}`;
}

/** «17.09.2026» */
export function fmtDate(d: Date | string | number): string {
  const p = dateParts(d);
  return `${p.dd}.${p.mm}.${p.yyyy}`;
}

/** «11:14» */
export function fmtHM(d: Date | string | number): string {
  const p = dateParts(d);
  return `${p.HH}:${p.MM}`;
}

/** «Четверг, 17 Сентябрь 2026» — the header of the workstation, month in the nominative as on the screenshots. */
export function fmtLongDate(d: Date | string | number): string {
  const p = dateParts(d);
  return `${p.weekday}, ${Number(p.dd)} ${MONTHS[Number(p.mm) - 1]} ${p.yyyy}`;
}

/**
 * Caption of a service plate: 156 district ДДС of the customer's list are named «Поселение …», so on a
 * narrow plate «Поселение Северное Бутово» and «Поселение ЮЗАО» both became «Поселение …». The common word
 * goes, the distinguishing part stays; the full name is in the plate's hint.
 */
export function plateCaption(shortName: string): string {
  return shortName.replace(/^Поселение\s+/, "").trim() || shortName;
}

/**
 * Font of a plate caption: the longest word has to fit the narrow plate whole — «Мосжилинспекция» on one
 * line in a smaller font rather than «Мосжилинспекц / ия»; a longer caption goes to a second line.
 */
export function plateCaptionClass(caption: string): string {
  const longest = Math.max(0, ...caption.split(/\s+/).map((w) => w.length));
  if (longest > 13) return "text-[10px] tracking-tight";
  return longest > 11 || caption.length > 11 ? "text-[11.5px]" : "text-[13px]";
}

/** The number that calls a counterpart back from the journal: its phone, or the crew number of a crew without one. */
export function redialNumber(c: { phone: string | null; crew: string | null }): string | null {
  return c.phone || c.crew || null;
}

/** «0:42», «12:05» */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const join = (list: (string | undefined | null | false)[], sep: string) => list.filter(Boolean).join(sep);

function streetPart(a: IncidentAddress): string {
  return join(
    [
      a.street,
      a.house && `д. ${a.house}`,
      a.building && `корп. ${a.building}`,
      a.structure && `стр. ${a.structure}`,
      a.entrance && `под. ${a.entrance}`,
      a.floor && `эт. ${a.floor}`,
      a.flat && `кв. ${a.flat}`,
    ],
    ", ",
  );
}

function areaPart(a: IncidentAddress): string | undefined {
  if (a.okrug && a.district) return `(${a.okrug}, ${a.district})`;
  return a.okrug || a.district ? `(${a.okrug ?? a.district})` : undefined;
}

/** What a crew or a caller says aloud: «пос. ЛМС, мкр. Солнечный, д. 12» (no country and city). */
export function addressShort(a: IncidentAddress | null | undefined): string {
  if (!a) return "";
  return streetPart(a) || a.descriptive || a.district || a.city || "";
}

/** Bold line of the card: «Россия, Москва, (ТАО, Вороновское), пос. ЛМС, д. 20». */
export function addressTitle(a: IncidentAddress | null | undefined): string {
  if (!a) return "";
  // A city inside a subject («Московская обл., Балашиха») is kept; «Москва, Москва» becomes «Москва».
  const city = a.subject && a.city && a.city !== a.subject ? a.city : undefined;
  return join([a.country ?? "Россия", a.subject ?? a.city, city, areaPart(a), a.object, streetPart(a)], ", ");
}

/** Feed column: «Москва , (ТАО, Вороновское) , пос. ЛМС, д. 20 , описательный адрес». */
export function addressFeed(a: IncidentAddress | null | undefined): string {
  if (!a) return "";
  return join([a.city ?? a.subject, areaPart(a), a.object, streetPart(a), a.descriptive], " , ");
}

/** Tags in one line, values of one row joined by commas: «Дом . Открытое пламя / Дым (дом), Запах гари (дом) . квартира .» */
export function tagsLine(tags: TagChoice[] | null | undefined): string {
  if (!tags?.length) return "";
  const groups: string[][] = [];
  let lastRow: string | null = null;
  for (const t of tags) {
    if (t.row && t.row === lastRow) groups[groups.length - 1].push(t.value);
    else groups.push([t.value]);
    lastRow = t.row || null;
  }
  return `${groups.map((g) => g.join(", ")).join(" . ")} .`;
}

/** «пожар: квартира ;» */
export function classLine(types: string[]): string {
  return types.map((t) => `${t} ;`).join(" ");
}

/** «Иванов Алексей Сергеевич» → «Иванов А С», as the memo shows authors of statuses. */
export function shortName(fullName: string): string {
  const [last, ...rest] = fullName.trim().split(/\s+/);
  return [last, ...rest.map((n) => n.charAt(0).toUpperCase())].join(" ");
}
