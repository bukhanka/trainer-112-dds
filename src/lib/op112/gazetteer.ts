/**
 * Offline address suggestions for the 112 card.
 *
 * The real workstation asks Yandex / FIAS; the trainer must work without the internet, so it
 * keeps a small street list with the district and okrug of each street. Look-alike names
 * (Дубнинская / Дубининская, Коломенская улица / набережная) are here on purpose: picking the
 * wrong one is a critical mistake in the review.
 */
import type { IncidentAddress } from "@/lib/incident/types";

type Place = { street: string; district?: string; okrug?: string; subject?: string; city?: string; source?: string };

const MSK = (street: string, district: string, okrug: string): Place => ({ street, district, okrug });

export const PLACES: Place[] = [
  // ЦАО
  MSK("Тверская улица", "Тверской", "ЦАО"),
  MSK("Лесная улица", "Тверской", "ЦАО"),
  MSK("Сущёвская улица", "Тверской", "ЦАО"),
  MSK("улица Арбат", "Арбат", "ЦАО"),
  MSK("улица Новый Арбат", "Арбат", "ЦАО"),
  MSK("Леонтьевский переулок", "Пресненский", "ЦАО"),
  MSK("Садовая-Кудринская улица", "Пресненский", "ЦАО"),
  MSK("улица Льва Толстого", "Хамовники", "ЦАО"),
  MSK("Комсомольский проспект", "Хамовники", "ЦАО"),
  MSK("Пятницкая улица", "Замоскворечье", "ЦАО"),
  MSK("Таганская улица", "Таганский", "ЦАО"),
  MSK("улица Покровка", "Басманный", "ЦАО"),
  MSK("улица Маросейка", "Басманный", "ЦАО"),
  // ЗАО
  MSK("Кутузовский проспект", "Дорогомилово", "ЗАО"),
  MSK("Большая Дорогомиловская улица", "Дорогомилово", "ЗАО"),
  MSK("площадь Киевского Вокзала", "Дорогомилово", "ЗАО"),
  { ...MSK("МЖД Киевское направление 1-й км", "Дорогомилово", "ЗАО"), source: "ФИАС" },
  MSK("Ярцевская улица", "Кунцево", "ЗАО"),
  MSK("Рублёвское шоссе", "Кунцево", "ЗАО"),
  MSK("улица Покрышкина", "Тропарёво-Никулино", "ЗАО"),
  MSK("Солнцевский проспект", "Солнцево", "ЗАО"),
  MSK("улица Богданова", "Солнцево", "ЗАО"),
  MSK("Можайское шоссе", "Можайский", "ЗАО"),
  // СЗАО
  MSK("улица Берзарина", "Щукино", "СЗАО"),
  MSK("улица Маршала Бирюзова", "Щукино", "СЗАО"),
  MSK("улица Маршала Василевского", "Щукино", "СЗАО"),
  MSK("улица Рогова", "Щукино", "СЗАО"),
  MSK("Щукинская улица", "Щукино", "СЗАО"),
  MSK("улица Народного Ополчения", "Хорошёво-Мнёвники", "СЗАО"),
  MSK("проспект Маршала Жукова", "Хорошёво-Мнёвники", "СЗАО"),
  MSK("улица Маршала Тухачевского", "Хорошёво-Мнёвники", "СЗАО"),
  MSK("Митинская улица", "Митино", "СЗАО"),
  MSK("Пятницкое шоссе", "Митино", "СЗАО"),
  MSK("улица Генерала Белобородова", "Митино", "СЗАО"),
  MSK("Туристская улица", "Северное Тушино", "СЗАО"),
  MSK("улица Героев Панфиловцев", "Северное Тушино", "СЗАО"),
  // ЮЗАО
  MSK("улица Грина", "Северное Бутово", "ЮЗАО"),
  MSK("бульвар Дмитрия Донского", "Северное Бутово", "ЮЗАО"),
  MSK("улица Гримау", "Академический", "ЮЗАО"),
  MSK("улица Островитянова", "Коньково", "ЮЗАО"),
  MSK("улица Академика Капицы", "Тёплый Стан", "ЮЗАО"),
  MSK("улица Новаторов", "Обручевский", "ЮЗАО"),
  // ЮАО
  MSK("Коломенская набережная", "Нагатинский Затон", "ЮАО"),
  MSK("Коломенская улица", "Нагатинский Затон", "ЮАО"),
  MSK("проспект Андропова", "Нагатинский Затон", "ЮАО"),
  MSK("Дубининская улица", "Даниловский", "ЮАО"),
  MSK("Балаклавский проспект", "Чертаново Северное", "ЮАО"),
  MSK("улица Мусы Джалиля", "Зябликово", "ЮАО"),
  MSK("Кантемировская улица", "Москворечье-Сабурово", "ЮАО"),
  // ЮВАО
  MSK("Ташкентская улица", "Выхино-Жулебино", "ЮВАО"),
  MSK("Жулебинский бульвар", "Выхино-Жулебино", "ЮВАО"),
  MSK("Братиславская улица", "Марьино", "ЮВАО"),
  MSK("улица Перерва", "Марьино", "ЮВАО"),
  MSK("Новочеркасский бульвар", "Марьино", "ЮВАО"),
  // ВАО
  MSK("Вешняковская улица", "Вешняки", "ВАО"),
  MSK("улица Молдагуловой", "Вешняки", "ВАО"),
  MSK("Хабаровская улица", "Гольяново", "ВАО"),
  MSK("Уральская улица", "Гольяново", "ВАО"),
  MSK("Тюменская улица", "Гольяново", "ВАО"),
  MSK("Первомайская улица", "Измайлово", "ВАО"),
  MSK("Измайловский бульвар", "Измайлово", "ВАО"),
  // САО
  MSK("Дубнинская улица", "Бескудниковский", "САО"),
  MSK("Флотская улица", "Ховрино", "САО"),
  // СВАО
  MSK("улица Академика Королёва", "Останкинский", "СВАО"),
  MSK("улица Бориса Галушкина", "Алексеевский", "СВАО"),
  MSK("улица Лескова", "Бибирево", "СВАО"),
  MSK("улица Пришвина", "Бибирево", "СВАО"),
  MSK("улица Корнейчука", "Бибирево", "СВАО"),
  MSK("Широкая улица", "Северное Медведково", "СВАО"),
  // ТиНАО
  { ...MSK("посёлок ЛМС, микрорайон Солнечный", "Вороновское", "ТиНАО"), source: "ФИАС" },
  // Московская область and other regions: no Moscow district, territorial services are not added
  { street: "Станционная улица", subject: "Московская область", city: "Королёв", okrug: "МО" },
  { street: "Мирской проезд", subject: "Московская область", city: "Балашиха", okrug: "МО" },
  { street: "микрорайон Подрезково", subject: "Московская область", city: "Химки", okrug: "МО" },
];

export const OKRUGS = ["ЦАО", "САО", "СВАО", "ВАО", "ЮВАО", "ЮАО", "ЮЗАО", "ЗАО", "СЗАО", "ЗелАО", "ТиНАО", "МО"];

const TYPE_WORDS: Record<string, string> = {
  ул: "улица",
  улица: "улица",
  пр: "проезд",
  проезд: "проезд",
  "пр-д": "проезд",
  пр_т: "проспект",
  "пр-т": "проспект",
  просп: "проспект",
  проспект: "проспект",
  пер: "переулок",
  переулок: "переулок",
  наб: "набережная",
  набережная: "набережная",
  ш: "шоссе",
  шоссе: "шоссе",
  б_р: "бульвар",
  "б-р": "бульвар",
  бул: "бульвар",
  бульвар: "бульвар",
  пл: "площадь",
  площадь: "площадь",
};

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"().,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Street split into a canonical type word and the name words. */
export function parseStreet(street: string): { type?: string; name: string } {
  const words = clean(street).split(" ").filter(Boolean);
  let type: string | undefined;
  const name: string[] = [];
  for (const w of words) {
    const t = TYPE_WORDS[w] ?? TYPE_WORDS[w.replace(/\.$/, "")];
    if (t && !type) type = t;
    else name.push(w);
  }
  return { type, name: name.sort().join(" ") };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** same — the same street; lookalike — a different street that is easy to confuse; other — unrelated. */
export function compareStreets(filled: string | undefined, truth: string | undefined): "same" | "lookalike" | "other" | "empty" {
  if (!filled?.trim()) return "empty";
  if (!truth?.trim()) return "other";
  const f = parseStreet(filled);
  const t = parseStreet(truth);
  if (f.name === t.name) return !f.type || !t.type || f.type === t.type ? "same" : "lookalike";
  const d = levenshtein(f.name, t.name);
  if (d <= 2 && Math.min(f.name.length, t.name.length) >= 4) return "lookalike";
  if (f.name.includes(t.name) || t.name.includes(f.name)) return "same";
  return "other";
}

export function normHouse(h: string | undefined): string {
  return clean(h ?? "").replace(/^(д|дом|вл|владение)\s*/, "").replace(/\s+/g, "");
}

export type AddressSuggestion = { label: string; source: string; address: IncidentAddress };

const HOUSE_RE = /^(?:д\.?|дом)?(\d+[а-я]?(?:\/\d+)?)$/;

/** «грина 11», «Берзарина д 21 к1», «коломенская наб 18» → suggestions with the fields filled. */
export function suggestAddress(query: string, limit = 8): AddressSuggestion[] {
  const tokens = clean(query)
    .replace(/^москва(?=\S)/, "")
    .split(" ")
    .filter(Boolean);
  if (!tokens.length) return [];
  let house: string | undefined;
  let building: string | undefined;
  let structure: string | undefined;
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    const m = HOUSE_RE.exec(t);
    if (m && !house && words.length) {
      house = m[1];
      continue;
    }
    const k = /^(?:к|корп|корпус)(\d+)$/.exec(t) ?? (/^(к|корп|корпус)$/.test(t) && next && /^\d+$/.test(next) ? [t, next] : null);
    if (k) {
      building = k[1];
      if (k[1] === next) i++;
      continue;
    }
    const s = /^(?:с|стр|строение)(\d+)$/.exec(t) ?? (/^(с|стр|строение)$/.test(t) && next && /^\d+$/.test(next) ? [t, next] : null);
    if (s) {
      structure = s[1];
      if (s[1] === next) i++;
      continue;
    }
    if (/^(москва|г|город|мск|д|дом)$/.test(t)) continue;
    words.push(t.replace(/\.$/, ""));
  }
  if (!words.length) return [];
  const matches = PLACES.filter((p) => {
    const hay = clean(`${p.street} ${p.city ?? ""}`);
    return words.every((w) => (TYPE_WORDS[w] ? hay.includes(TYPE_WORDS[w]) || hay.includes(w) : hay.includes(w)));
  });
  return matches.slice(0, limit).map((p) => {
    const address: IncidentAddress = {
      country: "Россия",
      subject: p.subject ?? "Москва",
      city: p.city ?? "Москва",
      street: p.street,
      house,
      building,
      structure,
      okrug: p.okrug,
      district: p.district,
    };
    const tail = [house && `д. ${house}`, building && `к. ${building}`, structure && `стр. ${structure}`].filter(Boolean).join(", ");
    const where = p.district ? `${p.okrug}, р-н ${p.district}` : [p.subject, p.city].filter(Boolean).join(", ");
    return {
      label: `${p.city && p.city !== "Москва" ? `${p.city}, ` : ""}${p.street}${tail ? `, ${tail}` : ""} — ${where}`,
      source: p.source ?? (p.subject && p.subject !== "Москва" ? "ФИАС" : "Яндекс"),
      address,
    };
  });
}

/** One line for the search field and the ДДС card: «улица Грина, д. 11, к. 1». */
export function addressLine(a: IncidentAddress | null | undefined): string {
  if (!a) return "";
  const parts = [
    a.city && a.city !== "Москва" ? a.city : undefined,
    a.street,
    a.house && `д. ${a.house}`,
    a.building && `к. ${a.building}`,
    a.structure && `стр. ${a.structure}`,
    a.flat && `кв. ${a.flat}`,
  ].filter(Boolean);
  return parts.join(", ");
}
