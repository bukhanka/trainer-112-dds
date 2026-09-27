import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { fakeModel } from "./fake-db";

// Drafts by category end to end on the customer's reference data (data/*.json), with and without a model.
type Row = Record<string, unknown>;
const classifier = readDataJson<{ groups: { id: number; name: string }[]; types: (Row & { code: number; routes: [string, string, string][] })[] }>(
  "classifier.json",
);
const store = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  library: [] as Record<string, unknown>[],
  model: null as null | ((messages: { role: string; content: string }[]) => unknown),
  session: { id: "t1", login: "teacher", fullName: "Смирнова", role: "TEACHER" as "TEACHER" | "ADMIN" | "STUDENT" },
  audit: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", async () => {
  const { readDataJson: read } = await import("@/lib/routing/reference-json");
  const c = read<{ groups: Row[]; types: (Row & { code: number; routes: [string, string, string][] })[] }>("classifier.json");
  const services = read<Row[]>("services.json");
  const routes = c.types.flatMap((t) => t.routes.map(([routeKey, condition, label]) => ({ typeCode: t.code, routeKey, condition, label })));
  return {
    db: {
      incidentType: fakeModel(c.types),
      incidentGroup: fakeModel(c.groups),
      route: fakeModel(routes),
      service: fakeModel(services),
      scenario: {
        findMany: async () => store.library,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `s${store.created.length + 1}`, ...data };
          store.created.push(row);
          return row;
        },
      },
    },
  };
});
vi.mock("@/lib/ai/provider", () => ({
  llmConfigured: () => store.model !== null,
  chatJson: async (messages: { role: string; content: string }[], schema: { parse: (v: unknown) => unknown }) => {
    if (!store.model) throw new Error("no model");
    return schema.parse(store.model(messages));
  },
}));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => (roles && !roles.includes(store.session.role) ? Response.json({ error: "forbidden" }, { status: 403 }) : store.session),
}));
vi.mock("@/lib/audit", () => ({ audit: async (entry: Record<string, unknown>) => void store.audit.push(entry) }));

const { generateByCategory } = await import("@/lib/scenarios/by-category");
const { POST } = await import("@/app/api/teacher/scenarios/generate/route");

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Created = {
  status: string;
  source: string;
  category: string;
  difficulty: number;
  teacherNote: string;
  approvedSections: string[];
  caller: { fullName: string; visibleAddress: string; hiddenAddress?: string; situation: string; facts: string[] };
  truth: { typeCodes: number[]; address: { street: string; house: string; district: string; okrug: string }; services: { shortName: string }[]; requiredQuestions: string[] };
  ddsReference: { services: unknown[] };
};
const created = () => store.created as unknown as Created[];
const groupOf = new Map(classifier.types.map((t) => [t.code, t.groupId as number]));

beforeEach(() => {
  store.created = [];
  store.library = [];
  store.model = null;
  store.audit = [];
  store.session = { id: "t1", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
});

describe("drafts by category, no model", () => {
  it("builds drafts of the category at addresses of the chosen district, all waiting for approval", async () => {
    const r = await generateByCategory({ category: "пожар", count: 3, difficulty: null, location: { okrug: "СЗАО", district: "Щукино" } }, { id: "t1" }, seeded(5));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.drafts).toHaveLength(3);
    expect(new Set(created().map((s) => s.truth.typeCodes[0])).size).toBe(3);
    for (const s of created()) {
      expect(s).toMatchObject({ status: "DRAFT", source: "generated", category: "пожар", approvedSections: [] });
      expect(groupOf.get(s.truth.typeCodes[0])).toBe(1);
      expect(s.truth.address).toMatchObject({ district: "Щукино", okrug: "СЗАО" });
      // The routing engine brings the district's own ДДС and the okrug prefecture once the district is known.
      expect(s.truth.services.map((x) => x.shortName)).toEqual(expect.arrayContaining(["Служба 101", "Поселение Щукино", "Поселение СЗАО"]));
      expect(s.truth.requiredQuestions.length).toBeGreaterThan(2);
      expect(s.ddsReference.services.length).toBeGreaterThan(0);
      expect(s.caller.situation.length).toBeGreaterThan(5);
      expect(`${s.caller.visibleAddress} ${s.caller.hiddenAddress ?? ""}`).toContain(`дом ${s.truth.address.house}`);
      expect(s.difficulty).toBeGreaterThanOrEqual(1);
      expect(s.teacherNote).toMatch(/Сгенерирован по категории «пожар»: локация — СЗАО, Щукино/);
      expect(s.teacherNote).toMatch(/по шаблону, без модели/);
    }
    expect(r.drafts.every((d) => !d.usedModel)).toBe(true);
  });

  it("keeps the difficulty the teacher asked for", async () => {
    const r = await generateByCategory({ category: "медицина", count: 2, difficulty: 8, location: { okrug: "ЦАО" } }, { id: "t1" }, seeded(9));
    expect(r.ok).toBe(true);
    for (const s of created()) {
      expect(s.difficulty).toBe(8);
      expect(groupOf.get(s.truth.typeCodes[0])).toBe(22);
      expect(s.truth.address.okrug).toBe("ЦАО");
      // At 8 the caller first names only the district and a landmark.
      expect(s.caller.visibleAddress).toMatch(/^район /);
      expect(s.caller.hiddenAddress).toMatch(/дом /);
    }
  });

  it("refuses a category without classifier groups or a district without streets", async () => {
    expect(await generateByCategory({ category: "служебный", count: 1, difficulty: null, location: null }, { id: "t1" })).toMatchObject({ ok: false });
    expect(await generateByCategory({ category: "пожар", count: 1, difficulty: null, location: { okrug: "СЗАО", district: "Нет такого" } }, { id: "t1" })).toMatchObject({
      ok: false,
    });
    expect(store.created).toHaveLength(0);
  });
});

describe("drafts by category, with a model", () => {
  it("takes the story from the model, but the leaf, the address and the services from the rules", async () => {
    let asked = "";
    store.model = (messages) => {
      asked = messages[1].content;
      return {
        title: "Горит квартира на третьем этаже",
        caller: {
          fullName: "Орлова Анна Петровна",
          role: "соседка",
          voice: "female",
          situation: "Здравствуйте, у соседей из окна валит дым!",
          visibleAddress: "Рогова улица, возле аптеки",
          hiddenAddress: null,
          facts: ["Дом девятиэтажный, газифицирован", "Пострадавших не видно"],
        },
        flags: { gas: true, traffic: false, victims: false },
        description: "Пожар в квартире, дым из окна, пострадавших нет",
      };
    };
    const r = await generateByCategory({ category: "пожар", count: 1, difficulty: 5, location: { okrug: "СЗАО", district: "Щукино" } }, { id: "t1" }, seeded(2));
    expect(r.ok && r.drafts[0].usedModel).toBe(true);
    const s = created()[0] as Created & { truth: { flags: Record<string, boolean> } };
    // The model is told the leaf and the exact address; it may not change them.
    const prompt = JSON.parse(asked) as { тип_происшествия: { название: string }; точный_адрес: { район: string } };
    expect(prompt.точный_адрес.район).toBe("Щукино");
    expect(s.truth.typeCodes[0]).toBe(classifier.types.find((t) => t.finalType === prompt.тип_происшествия.название)!.code);
    expect(s.caller.fullName).toBe("Орлова Анна Петровна");
    // The model forgot the house: the exact address is given on request all the same.
    expect(s.caller.hiddenAddress).toMatch(new RegExp(`^улица .+, дом ${s.truth.address.house}(,|$)`));
    // «Нет» of the model is dropped except for the gas of a house; «да» is kept.
    expect(s.truth.flags).toMatchObject({ gas: true });
    expect(s.truth.flags.traffic).toBeUndefined();
    expect(s.difficulty).toBe(5);
    expect(s.teacherNote).toMatch(/написала модель/);
  });

  it("falls back to the template when the model fails", async () => {
    store.model = () => ({ nonsense: true });
    const r = await generateByCategory({ category: "ДТП", count: 1, difficulty: null, location: null }, { id: "t1" }, seeded(4));
    expect(r.ok && r.drafts[0].usedModel).toBe(false);
    expect(created()[0].teacherNote).toMatch(/по шаблону/);
  });
});

describe("POST /api/teacher/scenarios/generate", () => {
  const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

  it("is for teachers only", async () => {
    store.session = { id: "u1", login: "student1", fullName: "Иванов", role: "STUDENT" };
    expect((await POST(post({ category: "пожар", count: 1 }))).status).toBe(403);
    expect(store.created).toHaveLength(0);
  });

  it("checks the request and writes each draft to the audit journal", async () => {
    expect((await POST(post({ category: "пожар", count: 9 }))).status).toBe(400);
    const res = await POST(post({ category: "газ", count: 2, difficulty: null, location: { okrug: "ВАО" } }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { drafts: { id: string; place: string }[] };
    expect(data.drafts).toHaveLength(2);
    expect(data.drafts.every((d) => d.place.startsWith("ВАО"))).toBe(true);
    expect(store.audit.map((a) => a.action)).toEqual(["scenario.generate", "scenario.generate"]);
    expect(store.audit[0]).toMatchObject({ actor: "teacher", entity: "Scenario", after: { via: "category", category: "газ" } });
  });
});
