/**
 * Phrase templates of a lesson («требования к синтаксису ответов», ТЗ п.99): the teacher writes the phrase
 * the final comment of a ДДС place must contain, with placeholders:
 *
 *   {номер}, {№}, {число}  — a number: «23», «23-А», «12/3»;
 *   {время}                — a time: «14:05», «14.05»;
 *   {дата}                 — a date: «27.09», «27.09.2026»;
 *   any other {…}          — any words («{кому}», «{что сделано}»);
 *   … or ...               — anything after, or nothing.
 *
 * Several templates — one per line; a comment passes when it contains any of them. Letter case, «ё»,
 * quotes, extra spaces and punctuation between words do not matter. Pure: used by the checks and by
 * the lesson form to try a template on an example.
 */

export const TEMPLATE_MAX_LINES = 5;
export const TEMPLATE_MAX_LENGTH = 400;

const PUNCT = "[\\s.,;:!?()\\-–—]";
const PLACEHOLDERS: { test: RegExp; pattern: string; hint: string }[] = [
  { test: /^(номер|№|число|n)$/i, pattern: "\\d+(?:[-/]?[а-яa-z0-9]+)*", hint: "номер цифрами" },
  { test: /^время$/i, pattern: "\\d{1,2}[:.]\\s?\\d{2}", hint: "время, например 14:05" },
  { test: /^дата$/i, pattern: "\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?", hint: "дата, например 27.09" },
];
const ANY = "[^\\n]+?";

/** Lower case, «е» for «ё», no quotes, «№23» / «#23» / «N 23» → «№ 23», single spaces. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'„“”]/g, "")
    .replace(/(?:№|#|(?<![a-zа-я])no?\.?)\s*(?=\d)/g, "№ ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTemplates(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, TEMPLATE_MAX_LINES);
}

type Part = { kind: "word"; text: string } | { kind: "slot"; name: string } | { kind: "rest" };

function parts(template: string): Part[] | null {
  const out: Part[] = [];
  const spaced = template.replace(/\.{3,}/g, "…").replace(/…/g, " … ");
  for (const m of spaced.matchAll(/\{([^{}]*)\}|(…)|([^\s{}…]+)|([{}])/g)) {
    if (m[4]) return null; // an unpaired brace
    if (m[1] !== undefined) out.push({ kind: "slot", name: m[1].trim() });
    else if (m[2]) out.push({ kind: "rest" });
    else {
      // A word without the punctuation around it: «направлен,» → «направлен».
      const word = normalizeText(m[3]).replace(/^[.,;:!?()\-–—]+|[.,;:!?()\-–—]+$/g, "");
      if (word) out.push({ kind: "word", text: word });
    }
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Why a template cannot be used, or null. */
export function templateProblem(template: string): string | null {
  const p = parts(template);
  if (!p) return `В шаблоне «${template}» непарная фигурная скобка`;
  if (!p.some((x) => x.kind === "word" && /[а-яa-z]{2,}/.test(x.text))) return `В шаблоне «${template}» нужно хотя бы одно слово`;
  return null;
}

export function templateRegex(template: string): RegExp | null {
  const p = parts(template);
  if (!p || templateProblem(template)) return null;
  let src = "";
  let prev: Part["kind"] | null = null;
  for (const x of p) {
    if (x.kind === "rest") {
      src += "[^\\n]*?";
      prev = "rest";
      continue;
    }
    // Words need a space or a sign between them; a number may stick to «№».
    if (prev === "word" && x.kind === "word") src += `${PUNCT}+`;
    else if (prev && prev !== "rest") src += `${PUNCT}*`;
    if (x.kind === "word") src += escape(x.text);
    else src += PLACEHOLDERS.find((ph) => ph.test.test(x.name))?.pattern ?? ANY;
    prev = x.kind;
  }
  return new RegExp(src, "i");
}

/** Does the text contain any of the templates? Unusable templates are skipped. */
export function matchTemplate(text: string, templates: string[]): { ok: boolean; template?: string } {
  const t = normalizeText(text);
  for (const template of templates) {
    const re = templateRegex(template);
    if (re?.test(t)) return { ok: true, template };
  }
  return { ok: false };
}

/** The placeholders of the templates in plain words: «{номер} — номер цифрами; … — дальше любой текст». */
export function describeTemplates(templates: string[]): string {
  const notes = new Set<string>();
  for (const t of templates) {
    for (const x of parts(t) ?? []) {
      if (x.kind === "rest") notes.add("«…» — дальше любой текст");
      if (x.kind === "slot") {
        const ph = PLACEHOLDERS.find((p) => p.test.test(x.name));
        notes.add(`{${x.name}} — ${ph ? ph.hint : "любые слова"}`);
      }
    }
  }
  return [...notes].join("; ");
}
