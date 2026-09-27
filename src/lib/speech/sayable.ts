/**
 * Text as people say it aloud. Tickets, cards and generated lines are full of written shorthand — «ул.», «д.»,
 * «кв.», «пр-т», «р-н», «т.е.», «03», «Б/П», «а/м», «ж/д», «км»: a speech synthesiser reads them letter by letter,
 * and a person on the phone never says them. The shorthand is spelt out before a line of a counterpart (caller,
 * crew, duty dispatcher) is stored and shown, and before any text is synthesised. What the trainee types is left
 * alone.
 *
 * Ambiguous marks are read by their neighbours: «д. 11» — дом, «д. Истомиха» — деревня; «м. Отрадное» — метро,
 * «50 м» — метров; «г. Москва» — город, «1979 г.» — года; «к. 2» after a house number — корпус. A place word takes
 * the case its preposition asks for: «на ул. Грина» — «на улице Грина», «к д. Истомиха» — «к деревне Истомиха»,
 * «съезд на ул. …» — «на улицу …», «на Коломенской наб.» — «на Коломенской набережной».
 */

type Case = "nom" | "gen" | "dat" | "acc" | "ins" | "pre";
type Forms = Record<Case, string>;

const forms = (nom: string, gen: string, dat: string, acc: string, ins: string, pre: string): Forms => ({ nom, gen, dat, acc, ins, pre });
/** A masculine noun: «проспект» — «проспекта», «проспекту»…; `stem` drops a fleeting vowel («переулок» — «переулка»). */
const masc = (nom: string, stem = nom): Forms => forms(nom, `${stem}а`, `${stem}у`, nom, `${stem}ом`, `${stem}е`);
/** A neuter noun in «-ие»: «строение» — «строения», «строению»… */
const neut = (nom: string): Forms => {
  const s = nom.slice(0, -1);
  return forms(nom, `${s}я`, `${s}ю`, nom, `${s}ем`, `${s}и`);
};
const fixed = (w: string): Forms => forms(w, w, w, w, w, w);

const STATION = forms("станция", "станции", "станции", "станцию", "станцией", "станции");
const VILLAGE = forms("деревня", "деревни", "деревне", "деревню", "деревней", "деревне");

/** «Ул. Грина» → «Улица Грина»: the spelt-out word keeps the capital of the mark. */
function keepCase(mark: string, word: string): string {
  return mark[0] && mark[0] !== mark[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

/** «1 километр», «2 километра», «5 километров»; a fraction takes the genitive singular («1,5 километра»). */
function plural(n: string, one: string, few: string, many: string): string {
  if (/[.,]/.test(n)) return few;
  const k = Number(n) % 100;
  if (k >= 11 && k <= 14) return many;
  const d = k % 10;
  return d === 1 ? one : d >= 2 && d <= 4 ? few : many;
}

/** A dot right after a unit is its own when a lower-case word, a digit or a comma follows; otherwise it ends the sentence. */
const UNIT_DOT = "(\\.(?=\\s?[\\p{Ll}\\d,]))?";

// ─── Place words and the case their preposition asks for ─────────────────────

const PREPOSITION: Record<string, Case> = {
  из: "gen", от: "gen", до: "gen", у: "gen", около: "gen", возле: "gen", вблизи: "gen", напротив: "gen", после: "gen",
  для: "gen", без: "gen", мимо: "gen", вдоль: "gen", с: "gen", со: "gen",
  по: "dat", к: "dat", ко: "dat",
  в: "pre", во: "pre", на: "pre", о: "pre", об: "pre", при: "pre",
  за: "ins", под: "ins", над: "ins", перед: "ins", между: "ins",
  через: "acc", про: "acc",
};
/** Words that take the next place in the genitive: «в сторону пос. …», «на углу ул. …», «не доезжая пос. …». */
const OF_NOUN = /^(сторон[уы]|угол|углу|угла|пересечени[еия]|перекрест(ок|ке|ка)|территори[ия]|район[еа]|центре|конце|начале|окраин[еы]|берег[уа]?|доезжая)$/u;
/** Movement turns «в» / «на» to the accusative: «съезд на ул. …» — «на улицу …», «из Некрасовки в г. …» — «в город …». */
const MOTION = /^(съезд|поворот|выезд|въезд|заезд|сверн|поверн|ехал|едем|еду|едет|едут|поехал|приехал|заехал|выйти|выход|вышл|вышел|пойти|пошл|пошел|иду|идем|идет|идут|направ|везут|везем|доех|переех|отвез|привез|бежать|побеж)/u;
/** «рядом с ул. …» — «рядом с улицей …», but «с ул. …» — «с улицы …». */
const WITH = new Set(["рядом", "вместе", "пересечение", "пересечении", "угол", "углу", "граничит", "стыке"]);
/** A capitalised adjective before a place word that follows its name: «Коломенская наб.», «Леонтьевский пер.». */
const ADJECTIVE: Record<"m" | "f" | "n", RegExp> = {
  m: /^\p{Lu}[\p{L}-]*(ий|ый|ой|ого|его|ому|ему|им|ым|ом|ем)$/u,
  f: /^\p{Lu}[\p{L}-]*(ая|яя|ой|ей|ую|юю)$/u,
  n: /^\p{Lu}[\p{L}-]*(ое|ее|ого|его|ому|ему|им|ым|ом|ем)$/u,
};

type Mark = {
  /** The written mark and what must follow it. */
  src: string;
  forms: Forms;
  /** Gender of a place word that may stand after its name («Тульская обл.»): the case then comes from the adjective. */
  post?: "m" | "f" | "n";
  /** A vehicle: «едут в а/м» is «в машине», not «в машину». */
  still?: boolean;
};

const NUM = "(?=\\s?-?\\d)";
const NAME = "(?=\\s?[\\p{Lu}«\"])";
const NOT_AFTER_NUMBER = "(?<!\\d\\s?)";
const END = "(?![\\p{L}])";

const MARKS: Mark[] = [
  { src: `[Дд]\\.\\s?вл\\.${NUM}`, forms: neut("владение") },
  { src: `[Вв]л\\.${NUM}`, forms: neut("владение") },
  { src: `[Мм]ос\\.\\s?обл\\.`, forms: forms("Московская область", "Московской области", "Московской области", "Московскую область", "Московской областью", "Московской области") },
  { src: `г\\.\\s?о\\.${END}`, forms: forms("городской округ", "городского округа", "городскому округу", "городской округ", "городским округом", "городском округе"), post: "m" },
  { src: `ст\\.\\s?м\\.${NAME}`, forms: forms("станция метро", "станции метро", "станции метро", "станцию метро", "станцией метро", "станции метро") },
  { src: `[Уу]л\\.`, forms: forms("улица", "улицы", "улице", "улицу", "улицей", "улице"), post: "f" },
  { src: `[Пп]ер\\.`, forms: masc("переулок", "переулк"), post: "m" },
  { src: `[Нн]аб\\.`, forms: forms("набережная", "набережной", "набережной", "набережную", "набережной", "набережной"), post: "f" },
  { src: `[Пп]л\\.`, forms: forms("площадь", "площади", "площади", "площадь", "площадью", "площади"), post: "f" },
  { src: `[Пп]росп\\.`, forms: masc("проспект"), post: "m" },
  { src: `[Пп]р-к?т\\.?${END}`, forms: masc("проспект"), post: "m" },
  { src: `[Пп]р-д\\.?${END}`, forms: masc("проезд"), post: "m" },
  { src: `[Бб]-р\\.?${END}`, forms: masc("бульвар"), post: "m" },
  { src: `[Мм]кр(?:-?н)?\\.?${END}`, forms: masc("микрорайон"), post: "m" },
  { src: `[Рр]-н\\.?${END}`, forms: masc("район"), post: "m" },
  { src: `[Оо]бл\\.`, forms: forms("область", "области", "области", "область", "областью", "области"), post: "f" },
  { src: `ш\\.`, forms: fixed("шоссе"), post: "n" },
  { src: `[Дд]еп\\.${NAME}`, forms: masc("департамент") },
  { src: `${NOT_AFTER_NUMBER}г\\.${NAME}`, forms: masc("город") },
  { src: `[Пп]ос\\.${NAME}`, forms: masc("посёлок", "посёлк") },
  { src: `[Дд]ер\\.${NAME}`, forms: VILLAGE },
  { src: `[Дд]\\.${NUM}`, forms: masc("дом") },
  { src: `д\\.${NAME}`, forms: VILLAGE },
  { src: `ст\\.${NAME}`, forms: STATION },
  { src: `${NOT_AFTER_NUMBER}м\\.${NAME}`, forms: fixed("метро") },
  { src: `${NOT_AFTER_NUMBER}р\\.${NAME}`, forms: forms("река", "реки", "реке", "реку", "рекой", "реке") },
  { src: `[Кк]орп\\.${NUM}`, forms: masc("корпус") },
  { src: `[Сс]тр\\.${NUM}`, forms: neut("строение") },
  { src: `[Пп]од\\.${NUM}`, forms: masc("подъезд") },
  { src: `[Ээ]т\\.${NUM}`, forms: masc("этаж") },
  { src: `[Кк]в\\.${NUM}`, forms: forms("квартира", "квартиры", "квартире", "квартиру", "квартирой", "квартире") },
  { src: `[Аа]\\/м${END}`, forms: forms("машина", "машины", "машине", "машину", "машиной", "машине"), still: true },
  { src: `[Жж]\\/д${END}`, forms: forms("железная дорога", "железной дороги", "железной дороге", "железную дорогу", "железной дорогой", "железной дороге") },
];

const MARK_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${MARKS.map((m) => `(${m.src})`).join("|")})`, "gu");

/** The two words before a mark within its clause, and whether a comma separates them from it (a list: nominative). */
function wordsBefore(before: string): { w0: string; w1: string; w1Raw: string; comma: boolean } {
  const clause = before.split(/[.!?;:()«»"\n]/).pop() ?? "";
  const raw = clause.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  const w = raw.map((x) => x.toLowerCase().replace(/ё/g, "е"));
  return { w0: w.at(-2) ?? "", w1: w.at(-1) ?? "", w1Raw: raw.at(-1) ?? "", comma: /,\s*$/.test(clause) };
}

/** The case of a place word from its preposition: «на ул.» — prepositional, «к д.» — dative, «из г.» — genitive. */
function caseByPreposition(w0: string, w1: string, clause: string, mark: Mark, previous: Case | null): Case {
  if (w1 === "и" || w1 === "или") return previous ?? "nom";
  if (OF_NOUN.test(w1)) return "gen";
  const c = PREPOSITION[w1];
  // «у плотины р. Шиворонь»: a noun in the genitive after «у» / «от» … takes the next name in the genitive too.
  if (!c) return PREPOSITION[w0] === "gen" && /[ыи]$/.test(w1) ? "gen" : "nom";
  if ((w1 === "в" || w1 === "во" || w1 === "на") && !mark.still && (MOTION.test(w0) || /(^|\s)(из|от)\s/.test(clause))) return "acc";
  if ((w1 === "с" || w1 === "со") && WITH.has(w0)) return "ins";
  return c;
}

/** The case of a place word after its adjective: «Тульская обл.» — nominative, «Леонтьевского пер.» — genitive. */
function caseByAdjective(adjective: string, fem: boolean, preposition: Case | undefined): Case {
  const a = adjective.toLowerCase();
  if (/(ий|ый|ая|яя|ое|ее)$/.test(a)) return "nom";
  if (/(ую|юю)$/.test(a)) return "acc";
  if (/(ого|его)$/.test(a)) return "gen";
  if (/(ому|ему)$/.test(a)) return "dat";
  if (/(ым|им)$/.test(a)) return "ins";
  if (/(ом|ем)$/.test(a)) return "pre";
  // «-ой» / «-ей»: a masculine «Большой»; a feminine noun takes the case of the preposition before the adjective.
  if (!fem) return "nom";
  return preposition && preposition !== "acc" ? preposition : "gen";
}

function placeWords(text: string): string {
  let previous: Case | null = null;
  return text.replace(MARK_RE, (found: string, ...args: unknown[]) => {
    const whole = args[args.length - 1] as string;
    const offset = args[args.length - 2] as number;
    const mark = MARKS[args.findIndex((a) => typeof a === "string" && a === found)];
    if (!mark) return found;
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + found.length);
    const { w0, w1, w1Raw, comma } = wordsBefore(before);
    const clause = (before.split(/[.!?;:()«»"\n]/).pop() ?? "").toLowerCase();
    const post = !comma && mark.post !== undefined && ADJECTIVE[mark.post].test(w1Raw);
    const c: Case = comma || !w1
      ? "nom"
      : post
        ? caseByAdjective(w1, mark.post === "f", PREPOSITION[w0])
        : caseByPreposition(w0, w1, clause, mark, previous);
    previous = c;
    let word = keepCase(found, mark.forms[c]);
    // A mark after its name may end the sentence with its dot: «…на Коломенской наб. Приезжайте!».
    if (post && found.endsWith(".") && /^\s+[\p{Lu}«"]/u.test(after)) word += ".";
    // «д.5», «ул.Грина»: the spelt-out word needs a space before what follows.
    return /^[\p{L}\p{N}«"]/u.test(after) ? `${word} ` : word;
  });
}

// ─── Rail, «имени», units, years ─────────────────────────────────────────────

/** «ж/д переезд» — «железнодорожный переезд»: the adjective agrees with the noun after it. */
const RAIL: Record<string, string> = {
  пути: "ые", путей: "ых", путям: "ым", путями: "ыми", путях: "ых",
  полотно: "ое", полотна: "ого", полотну: "ому", полотном: "ым", полотне: "ом",
};
for (const s of ["переезд", "переход", "мост", "вокзал", "путепровод", "тупик"]) {
  Object.assign(RAIL, { [s]: "ый", [`${s}а`]: "ого", [`${s}у`]: "ому", [`${s}ом`]: "ым", [`${s}е`]: "ом" });
}
for (const s of ["платформ", "ветк"]) {
  Object.assign(RAIL, { [`${s}а`]: "ая", [`${s}ы`]: "ой", [`${s}и`]: "ой", [`${s}е`]: "ой", [`${s}у`]: "ую", [`${s}ой`]: "ой" });
}
for (const s of ["станци", "лини"]) Object.assign(RAIL, { [`${s}я`]: "ая", [`${s}и`]: "ой", [`${s}ю`]: "ую", [`${s}ей`]: "ой" });

/** Places named after someone: «им.» — «имени» before initials or after a hospital, a park, a street… */
const NAMED_PLACE =
  "(?:больниц|клиник|ГКБ|парк|сквер|школ|гимнази|лице|институт|университет|академи|центр|станци|завод|фабрик|стадион|библиотек|музе|театр|улиц|площад|проспект|переул|бульвар|набережн|помощи|госпитал|колледж|училищ|комбинат|двор|усадьб|ДК|ул\\.)";

const RULES: [RegExp, (...m: string[]) => string][] = [
  // Everyday shorthand.
  [/(?<![\p{L}])([Тт])\.\s?е\./gu, (_m, t) => keepCase(t, "то есть")],
  [/(?<![\p{L}])([Тт])\.\s?к\./gu, (_m, t) => keepCase(t, "так как")],
  [/(?<![\p{L}])т\.\s?д\./gu, () => "так далее"],
  [/(?<![\p{L}])т\.\s?п\./gu, () => "тому подобное"],
  [/(?<![\p{L}\p{N}])Б\/П(?![\p{L}])/giu, () => "без пострадавших"],
  [/(?<![\p{L}\p{N}])д\/р(?![\p{L}])/giu, () => "дата рождения"],
  // «03» is the ambulance; not inside a time, a date or a phone number.
  [/(?<![\d:.\-/()+])\b0?3 не требуется/giu, () => "скорая не нужна"],
  [/(?<![\p{L}\p{N}:.\-/()+])([Вв]) 03(?![\d:.\-/])/gu, (_m, v) => `${v} скорую`],
  [/(вызов\p{L}*|вызв\p{L}*|нужн\p{L}*|жд\p{L}*)\s03(?![\d:.\-/])/giu, (_m, w) => `${w} скорую`],
  // …but a door code or a flat «03» stays a number.
  [/(?<![\p{L}\p{N}:.\-/()+])(?<!(?:код|номер|кв\.?|квартира|дом|д\.|этаж|эт\.|под\.|подъезд)\s?)03(?![\d:.\-/])/giu, () => "скорая"],
  [/№\s?/gu, () => "номер "],
  // Units after a number.
  [new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?(?:кв\\.\\s?м|м²)${UNIT_DOT}(?![\\p{L}\\d])`, "gu"), (_m, n) => `${n} ${plural(n, "квадратный метр", "квадратных метра", "квадратных метров")}`],
  [/\s*×\s*(?=\d)/gu, () => " на "],
  [/(\d+)\s?км\/ч(?![\p{L}])/gu, (_m, n) => `${n} ${plural(n, "километр", "километра", "километров")} в час`],
  [/(\d+)-(й|м|го|му)\s?км(?![\p{L}/])/gu, (_m, n, e) => `${n}-${e} ${{ й: "километр", м: "километре", го: "километра", му: "километру" }[e]}`],
  [/(\d+)\s?[–-]\s?(\d+)\s?км(?![\p{L}/])/gu, (...m) => (roadBefore(m) ? `с ${m[1]}-го по ${m[2]}-й километр` : `${m[1]}–${m[2]} километров`)],
  [new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?км${UNIT_DOT}(?![\\p{L}/])`, "gu"), (...m) =>
    roadBefore(m) || /^\s?по столб/u.test(after(m)) ? `${m[1]}-й километр` : `${m[1]} ${plural(m[1], "километр", "километра", "километров")}`],
  [new RegExp(`(?<![\\p{L}\\d.,])(\\d+(?:[.,]\\d+)?)\\s?м${UNIT_DOT}(?![\\p{L}\\d²])`, "gu"), (_m, n) => `${n} ${plural(n, "метр", "метра", "метров")}`],
  [/(\d+)\s?(?:руб\.?|р\.)(?![\p{L}])/gu, (_m, n) => `${n} ${plural(n, "рубль", "рубля", "рублей")}`],
  // Years: «в 1979 г.» — «в 1979 году», «1979 г.р.» — «1979 года рождения».
  [/(\d{4})\s?г\.\s?р\.(?![\p{L}])/gu, (_m, y) => `${y} года рождения`],
  [/(?<![\p{L}])([Вв]о?)\s(\d{4})\s?г\.(?=(\s+[\p{Lu}«"])?)(?![\p{L}])/gu, (_m, v, y, end) => `${v} ${y} году${end !== undefined ? "." : ""}`],
  [/(\d{4})\s?г\.(?=(\s+[\p{Lu}«"])?)(?![\p{L}])/gu, (_m, y, end) => `${y} года${end !== undefined ? "." : ""}`],
  // Written case endings of hyphenated marks: «пр-та» — «проспекта», «р-не» — «районе».
  [/(?<![\p{L}])(пр-к?т|р-н|мкр-н|б-р|пр-д)(?=(?:а|у|ом|е)(?![\p{L}]))/giu, (m) =>
    keepCase(m, { "пр-т": "проспект", "пр-кт": "проспект", "р-н": "район", "мкр-н": "микрорайон", "б-р": "бульвар", "пр-д": "проезд" }[m.toLowerCase()] ?? m)],
  [/(?<![\p{L}])([Жж])\/д\s(\p{L}+)/gu, (m, j, noun) => (RAIL[noun.toLowerCase()] ? `${keepCase(j, "железнодорожн")}${RAIL[noun.toLowerCase()]} ${noun}` : m)],
  [/(?<![\p{L}])им\.\s?(?=\p{Lu}\.)/gu, () => "имени "],
  [new RegExp(`(?<=${NAMED_PLACE}[^.!?;\\n]{0,40})(?<![\\p{L}])им\\.\\s?(?=\\p{Lu})`, "gu"), () => "имени "],
];

/** Arguments of a replace callback: the text before and after the match. */
function before(m: string[]): string {
  const offset = m[m.length - 2] as unknown as number;
  return m[m.length - 1].slice(0, offset);
}
function after(m: string[]): string {
  const offset = m[m.length - 2] as unknown as number;
  return m[m.length - 1].slice(offset + m[0].length);
}
/** «МКАД, 73 км», «трасса М-2, 25 км» — a kilometre post, said «семьдесят третий километр». */
function roadBefore(m: string[]): boolean {
  return /(?:МКАД|ТТК|МЖД\s[\p{L}-]+|трасс[аеуы]\s[\p{L}\d-]+|шоссе|ш\.|направлени[еия]|кольц[оае])[\s,(]*$/u.test(before(m));
}

/** «ул. Берзарина, д. 21, к. 1» — the «к.» / «с.» right after a house number is корпус / строение. */
const AFTER_HOUSE: [RegExp, string][] = [
  [/(\d[\p{L}\d/]*)\s*,?\s+к\.\s?(?=\d)/gu, "$1, корпус "],
  [/(\d[\p{L}\d/]*)\s*,?\s+с\.\s?(?=\d)/gu, "$1, строение "],
];

/** The line as it is said aloud: written shorthand spelt out, nothing else changed. */
export function sayable(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to as never);
  out = placeWords(out);
  for (const [re, to] of AFTER_HOUSE) out = out.replace(re, to);
  return out.replace(/[ \t]{2,}/g, " ").trim();
}
