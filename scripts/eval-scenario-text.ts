/**
 * «Сценарий из текста» on 14 short, different texts written the way a teacher types them: fire, road
 * accidents, medicine, gas, a fight, a drowning man, doors to open with a life at stake, a lift, a leak,
 * a suicide, a suspicious bag. For each — the group and the classifier types an expert accepts and the
 * services that must be on the card. Builds a real draft (the same code as the screen), compares, deletes it.
 *
 *   pnpm exec tsx scripts/eval-scenario-text.ts            with the model from .env (paced, ≤ 10 calls a minute)
 *   pnpm exec tsx scripts/eval-scenario-text.ts --rules    without the model
 *   … --out results.json                                   also write the rows
 */
import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";

const rules = process.argv.includes("--rules");
if (rules) delete process.env.LLM_BASE_URL;
const outAt = process.argv.indexOf("--out");
const out = outAt > 0 ? process.argv[outAt + 1] : null;
/** Seconds between texts with the model: a draft takes up to two calls. */
const PACE = rules ? 0 : 15;

type Case = { text: string; group: number; types: number[]; services: string[] };

const CASES: Case[] = [
  {
    text: "У соседки третий день не открывают дверь, из квартиры запах, ей 80 лет, живёт одна. Улица Рогова, 12, квартира 45.",
    group: 17,
    // Открыть дверь: не подаёт признаков жизни / трупный запах / требуется мед. помощь — дверь вскрывают спасатели.
    types: [17080200, 17080300, 17080100],
    services: ["Служба 101"],
  },
  { text: "Горит квартира на пятом этаже, в квартире остался ребёнок, улица Грина, 11.", group: 1, types: [1050101], services: ["Служба 101"] },
  {
    text: "На Кутузовском проспекте у дома 30 столкнулись две машины, водителя зажало, он не может выйти.",
    group: 2,
    types: [2021700],
    services: ["Служба 101", "Служба 103"],
  },
  { text: "Бабушке 80 лет плохо с сердцем, задыхается, улица Грина, 11.", group: 22, types: [22370000], services: ["Служба 103"] },
  { text: "В подъезде сильно пахнет газом, улица Вавилова, 81.", group: 13, types: [13020500], services: ["Служба 104"] },
  { text: "Во дворе дерутся трое, у одного нож, Тюменская улица, 5.", group: 15, types: [15060201], services: ["Служба 102"] },
  {
    text: "На Москве-реке у Крымского моста тонет человек, его уносит течением.",
    group: 17,
    types: [17070200],
    services: ["Служба 101", "Служба 103"],
  },
  {
    text: "Маленький ребёнок один заперт в квартире и плачет, родители ушли, ключей нет. Улица Бутлерова, 17.",
    group: 17,
    types: [17080400],
    services: ["Служба 101"],
  },
  { text: "Застряли в лифте между пятым и шестым этажом, нас двое, улица Берзарина, 21.", group: 14, types: [14100100], services: ["Мослифт"] },
  {
    text: "Сосед сверху заливает, вода течёт по стене, искрит проводка. Улица Рогова, 12, квартира 45.",
    group: 14,
    types: [14020300],
    services: ["Деп. ЖКХ"],
  },
  {
    text: "Мужчина сидит на краю крыши девятиэтажки и говорит, что прыгнет. Улица Паустовского, 8.",
    group: 17,
    types: [17100900],
    services: ["Служба 102", "Служба 103"],
  },
  {
    text: "На пешеходном переходе у дома 5 на Профсоюзной улице машина сбила женщину, она лежит.",
    group: 2,
    types: [2020100],
    services: ["Служба 102", "Служба 103"],
  },
  {
    text: "У входа в торговый центр на Ленинградском проспекте, 62, лежит бесхозная сумка, из неё торчат провода.",
    group: 15,
    types: [15130600],
    services: ["Служба 102"],
  },
  { text: "На остановке у дома 3 по Ленинскому проспекту мужчине плохо, лежит, не отвечает.", group: 22, types: [22020000], services: ["Служба 103"] },
];

type Truth = { typeCodes?: number[]; finalType?: string; flags?: Record<string, boolean>; services?: { shortName: string }[] };

(async () => {
  const { generateScenarioDraft } = await import("@/lib/scenarios/generate");
  const teacher = await db.user.findFirstOrThrow({ where: { role: "TEACHER" }, select: { id: true } });
  const types = new Map((await db.incidentType.findMany({ select: { code: true, groupId: true } })).map((t) => [t.code, t.groupId]));
  const rows: Record<string, unknown>[] = [];
  let [group, type, services, all, model] = [0, 0, 0, 0, 0];
  for (const [i, c] of CASES.entries()) {
    if (i && PACE) await new Promise((r) => setTimeout(r, PACE * 1000));
    const res = await generateScenarioDraft({ text: c.text }, teacher);
    const s = await db.scenario.findUniqueOrThrow({ where: { id: res.id }, select: { truth: true } });
    await db.scenario.delete({ where: { id: res.id } });
    const truth = s.truth as Truth;
    const code = truth.typeCodes?.[0] ?? null;
    const got = (truth.services ?? []).map((x) => x.shortName);
    const ok = { group: code != null && types.get(code) === c.group, type: code != null && c.types.includes(code), services: c.services.every((n) => got.includes(n)) };
    group += Number(ok.group);
    type += Number(ok.type);
    services += Number(ok.services);
    all += Number(ok.group && ok.type && ok.services);
    model += Number(res.usedModel);
    const flags = Object.entries(truth.flags ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(",");
    console.log(
      `${ok.group && ok.type && ok.services ? "✓" : "✗"} ${c.text.slice(0, 60).padEnd(60)} | ${truth.finalType ?? "—"} [${flags}] | ${got.filter((n) => /^Служба|Мослифт|ЖКХ/.test(n)).join(", ")}` +
        `${ok.services ? "" : ` — нет ${c.services.filter((n) => !got.includes(n)).join(", ")}`}`,
    );
    rows.push({ text: c.text, expected: c, finalType: truth.finalType, code, flags, services: got, ok, usedModel: res.usedModel });
  }
  const n = CASES.length;
  console.log(`\n${rules ? "без модели" : `с моделью (${model} из ${n} — модель ответила)`}: группа ${group}/${n}, тип ${type}/${n}, нужные службы ${services}/${n}, всё верно ${all}/${n}`);
  if (out) writeFileSync(out, JSON.stringify({ rules, group, type, services, all, n, rows }, null, 2));
  await db.$disconnect();
})();
